#!/usr/bin/env python3
"""Validate this handoff's documents, contracts and synthetic arithmetic."""

import json
import re
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
ERRORS = []
REQUIREMENTS = {f"R{number:02d}" for number in range(1, 19)}
TASKS = {f"T{number:02d}" for number in range(1, 14)}
SOURCE_GROUP_SIZES = [7, 8, 7, 7, 9, 8, 7, 7, 8, 8, 8]
ORIGINAL_IDS = {
    f"GT-{group * 100 + index}"
    for group, size in enumerate(SOURCE_GROUP_SIZES, start=1)
    for index in range(1, size + 1)
}


def check(condition, message):
    if not condition:
        ERRORS.append(message)


def read_json(relative_path):
    return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))


def pack_files(suffix):
    """Only inspect the handoff, never installed dependencies or private runtime data."""
    yield from ROOT.glob(f"*{suffix}")
    for directory in ("docs", "contracts", "fixtures"):
        yield from (ROOT / directory).rglob(f"*{suffix}")


def check_document_links():
    required = [
        "README.md", "AGENTS.md", "CODEX-START.md", ".env.example",
        "docs/00-contract-spine.md", "docs/01-product-spec.md",
        "docs/02-business-rules.md", "docs/03-architecture.md",
        "docs/04-data-model.md", "docs/05-api-contracts.md",
        "docs/06-security-integrations.md", "docs/07-ui-spec.md",
        "docs/08-acceptance-tests.md", "docs/09-setup-release.md",
        "docs/IMPLEMENTATION-STATUS.md",
        "docs/superpowers/plans/2026-11-11-git-tutor.md",
        "contracts/pricing-policy.json", "contracts/policy-settings.json",
        "fixtures/acceptance-cases.json", "fixtures/domain-scenarios.json",
    ]
    for relative_path in required:
        path = ROOT / relative_path
        check(path.is_file() and path.stat().st_size > 0, f"Missing file {relative_path}")
    for path in pack_files(".md"):
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]+\]\(([^\s)]+)\)", content):
            parts = urlsplit(target.strip("<>"))
            if parts.scheme or not parts.path:
                continue
            linked = path.parent / unquote(parts.path)
            check(linked.exists(), f"Broken link in {path.relative_to(ROOT)} to {target}")


def check_pricing(pricing):
    public = pricing["customer_pricing"]
    tiers = {item["group_size"]: item for item in public["group_tiers"]}
    expected_prices = {2: 57500, 3: 55000, 4: 50000}
    check(set(tiers) == set(expected_prices), "Group pricing tiers must be 2, 3 and 4")
    for size, amount in expected_prices.items():
        check(tiers[size]["seat_price_minor"] == amount, f"Incorrect seat price for {size}")
    bands = {
        item["tier_id"]: item
        for item in pricing["internal_compensation"]["group_fee_bands"]
    }
    expected_bands = {"group_2": (45000, 45000), "group_3": (60000, 65000), "group_4": (70000, 75000)}
    for tier_id, expected in expected_bands.items():
        band = bands[tier_id]
        check((band["fee_min_minor"], band["fee_max_minor"]) == expected, f"Incorrect fee band {tier_id}")
    forbidden = ("tutor_fee", "compensation", "contribution", "margin", "payout_destination")
    for field in public["projection_fields"]:
        check(not any(marker in field for marker in forbidden), f"Internal public field {field}")
    examples = pricing["development_examples"]
    for example in examples["exact_fee_selections"]:
        band = bands[example["tier_id"]]
        fee = example["exact_fee_minor"]
        check(band["fee_min_minor"] <= fee <= band["fee_max_minor"], "Example fee outside approved band")
        check(example["tuition_minor"] - fee == example["contribution_minor"], "Contribution arithmetic mismatch")
    for amendment in examples["accepted_amendments"]:
        original_tier = next(item for item in tiers.values() if item["tier_id"] == amendment["from_tier_id"])
        original_total = original_tier["group_size"] * original_tier["seat_price_minor"]
        credit = amendment["credit_per_existing_enrollment_minor"] * amendment["existing_enrollment_count"]
        total = original_total - credit + amendment["new_enrollment_charge_minor"]
        check(total == amendment["new_tuition_total_minor"], "Amendment charge conservation mismatch")


def check_policy(policy):
    runtime = policy["runtime_policy"]
    check(runtime["status"] == "draft", "Initial runtime policy must remain draft")
    check(all(value is None for key, value in runtime.items() if key != "status"), "Unapproved runtime policy values found")
    gate = policy["publication_gate"]
    for example in policy["development_examples"]:
        check(example["status"] == "synthetic_non_publishable", "Missing synthetic example envelope")
        check(example["business_approval"] is False, "Synthetic example claims business approval")
        if "policy" not in example:
            continue
        simulated = example["policy"]
        check(simulated["environment_scope"] == "development_test" and simulated["is_synthetic"] is True, "Unsafe synthetic policy scope")
        check(simulated["status"] == "published", "Simulated policy must support local booking")
        fields = gate["required_fields_common"] + gate["required_fields_for_" + simulated["offer_format"]]
        if simulated["package_enabled"]:
            fields += gate["required_when_package_enabled"]
            check(simulated["package_contract"]["credit_quanta_per_session"] == 1000, "Incorrect package quantity basis")
        for field in fields:
            check(field in simulated and simulated[field] is not None, f"Incomplete synthetic policy field {field}")


def check_acceptance(catalog, fixtures):
    cases = catalog["cases"]
    ids = [case["id"] for case in cases]
    check(len(ids) == len(set(ids)), "Duplicate acceptance IDs")
    original = {case["id"] for case in cases if case["source_case_id"] is not None}
    check(original == ORIGINAL_IDS, "Original 84 acceptance IDs changed")
    check({case["requirement_id"] for case in cases} == REQUIREMENTS, "Incomplete requirement coverage")
    check({case["owning_task"] for case in cases} == TASKS, "Incomplete task coverage")
    scenario_ids = {scenario["id"] for scenario in fixtures["scenarios"]}
    check(len(scenario_ids) == len(fixtures["scenarios"]), "Duplicate scenario IDs")
    for case in cases:
        check(case["layer"] in catalog["layer_enum"], f"Unknown test layer in {case['id']}")
        check(case["priority"] in {"P0", "P1", "P2"}, f"Unknown priority in {case['id']}")
        check(set(case["related_requirement_ids"]).issubset(REQUIREMENTS), f"Unknown requirement in {case['id']}")
        check(set(case["scenario"]["fixture_ids"]).issubset(scenario_ids), f"Dangling fixture in {case['id']}")
        check(bool(case["expected"]["assertions"]) and bool(case["test_file"]), f"Incomplete test contract in {case['id']}")
        check(case["implementation_status"] in {"planned", "in_progress", "implemented", "deferred"}, f"Unknown implementation status in {case['id']}")
        check(case["execution_status"] in {"not_run", "passed", "failed", "blocked", "skipped"}, f"Unknown execution status in {case['id']}")
    summary = catalog["summary"]
    check(summary["total_cases"] == len(cases), "Stale acceptance count")
    check(summary["preserved_source_cases"] == len(original), "Stale preserved-source count")
    check(summary["new_regressions"] == len(cases) - len(original), "Stale regression count")
    check(summary["by_priority"] == dict(Counter(case["priority"] for case in cases)), "Stale priority counts")
    check(summary["by_primary_requirement"] == dict(Counter(case["requirement_id"] for case in cases)), "Stale requirement counts")
    check(summary["by_owning_task"] == dict(Counter(case["owning_task"] for case in cases)), "Stale task counts")
    for actor in fixtures["actors"]:
        check(actor["email"].endswith("@example.test"), "Fixture contains a non-synthetic email")
    check(fixtures["credit_representation"]["credit_quanta_per_session"] == 1000, "Fixture credit basis differs from contract")


def check_scenario_arithmetic(fixtures):
    scenarios = {item["id"]: item for item in fixtures["scenarios"]}
    for name in ("SCN-PRICE-TWO", "SCN-PRICE-THREE", "SCN-PRICE-FOUR"):
        scenario = scenarios[name]
        source, expected = scenario["input"], scenario["expected"]
        tuition = source["group_size"] * source["seat_price_minor"]
        check(tuition == expected["customer_tuition_total_minor"], f"Incorrect tuition in {name}")
        check(tuition - source["approved_tutor_fee_minor"] == expected["internal_contribution_minor"], f"Incorrect contribution in {name}")
    overpayment = scenarios["SCN-OVERPAYMENT"]
    source, expected = overpayment["input"], overpayment["expected"]
    check(source["settled_transfer_minor"] == expected["allocated_minor"] + expected["customer_credit_liability_minor"], "Overpayment conservation failed")
    transfers = scenarios["SCN-PARTIAL-TRANSFERS"]
    check(sum(transfers["input"]["settled_transfer_amounts_minor"]) == transfers["expected"]["allocated_minor"], "Installment conservation failed")
    partial = scenarios["SCN-PARTIAL-PAYOUT"]
    check(partial["input"]["earned_minor"] - partial["input"]["settled_payout_minor"] == partial["expected"]["payable_minor"], "Partial payout arithmetic failed")
    transfer = scenarios["SCN-PACKAGE-TRANSFER"]
    source, expected = transfer["input"], transfer["expected"]
    for suffix in ("available_credit_quanta", "unearned_value_minor"):
        original = source["source_" + suffix] + source["target_" + suffix]
        resulting = expected["source_" + suffix] + expected["target_" + suffix]
        check(original == resulting == expected["combined_" + suffix], f"Package transfer failed for {suffix}")
    rounding = scenarios["SCN-PACKAGE-ROUNDING"]
    remaining_value = rounding["input"]["package_price_minor"]
    remaining_quanta = rounding["input"]["grant_credit_quanta"]
    entries = []
    for quanta in rounding["input"]["consumption_steps_credit_quanta"]:
        value = remaining_value * quanta // remaining_quanta
        entries.append(value)
        remaining_value -= value
        remaining_quanta -= quanta
    check(entries == rounding["expected"]["recognition_entries_minor"], "Sequential package rounding mismatch")
    uneven = rounding["uneven_portion_variant"]
    remaining_value = uneven["package_price_minor"]
    remaining_quanta = uneven["grant_credit_quanta"]
    entries = []
    for quanta in uneven["consumption_steps_credit_quanta"]:
        value = remaining_value * quanta // remaining_quanta
        entries.append(value)
        remaining_value -= value
        remaining_quanta -= quanta
    check(entries == uneven["expected_recognition_entries_minor"], "Uneven package rounding mismatch")
    batch = rounding["batch_variant"]
    portions = batch["allocation_credit_quanta"]
    value = batch["package_price_minor"]
    total_quanta = batch["grant_credit_quanta"]
    divisions = [divmod(value * quantity, total_quanta) for quantity in portions]
    allocations = [quotient for quotient, remainder in divisions]
    ordered = sorted(range(len(portions)), key=lambda index: (-divisions[index][1], batch["ordered_allocation_ids"][index]))
    for index in ordered[:value - sum(allocations)]:
        allocations[index] += 1
    check(allocations == batch["expected_allocated_values_minor"], "Batch package rounding mismatch")
    partial = scenarios["SCN-PACKAGE-PARTIAL"]
    source, expected = partial["input"], partial["expected"]
    consumed = source["approved_consumption_credit_quanta"]
    check(source["grant_credit_quanta"] - consumed == expected["remaining_credit_quanta"], "Partial package quantity mismatch")
    consumed_value = source["package_price_minor"] * consumed // source["grant_credit_quanta"]
    check(consumed_value == expected["earned_customer_tuition_minor"], "Partial package value mismatch")
    check(source["package_price_minor"] - consumed_value == expected["remaining_contract_liability_minor"], "Partial package liability mismatch")
    fee = source["original_full_occurrence_tutor_fee_minor"] + source["approved_tutor_fee_adjustment_minor"]
    check(fee == expected["approved_tutor_earning_minor"], "Partial tutor fee adjustment mismatch")
    coverage = scenarios["SCN-PACKAGE-COVERAGE-MODES"]
    source = coverage["input"]
    modes = {item["coverage_rule"]: item["expected"] for item in coverage["coverage_modes"]}
    named = modes["named_entitlement_covers_eligible_occurrence"]
    funded = modes["allocated_value_with_explicit_top_up"]
    carrying = source["original_funded_lot_carrying_value_minor"]
    reference = source["standalone_seat_reference_price_minor"]
    check(named["additional_receivable_minor"] == 0 and named["additional_cash_due_minor"] == 0, "Named package coverage creates additional debt")
    check(named["package_tuition_recognized_minor"] == carrying, "Named package revenue differs from carrying value")
    check(funded["additional_receivable_minor"] == reference - carrying, "Value-funded package top-up mismatch")
    check(funded["applied_package_value_minor"] + funded["separate_monetary_tuition_component_minor"] == funded["total_tuition_recognized_on_authorized_delivery_minor"], "Value-funded package revenue counted incorrectly")
    boundary = coverage["deposit_boundary_variant"]
    threshold = (reference * source["deposit_basis_points"] + 9999) // 10000
    shortfall = threshold - boundary["original_funded_lot_carrying_value_minor"]
    check(shortfall == boundary["value_coverage_expected"]["deposit_shortfall_minor"], "Package deposit boundary mismatch")
    ledger = scenarios["SCN-LEDGER"]["expected"]
    check(ledger["cash_receipts_minor"] - ledger["cash_disbursements_minor"] == ledger["cash_balance_minor"], "Cash reconciliation failed")
    check(ledger["earned_tuition_minor"] - ledger["tutor_expense_minor"] - ledger["marketing_expense_minor"] == ledger["operating_result_minor"], "Operating result reconciliation failed")
    obligations = ledger["package_contract_liability_minor"] + ledger["customer_credit_liability_minor"] + ledger["tutor_payable_minor"]
    check(obligations + ledger["operating_result_minor"] == ledger["cash_balance_minor"], "Fixture balance reconciliation failed")
    for key in ("cash_balance_minor", "tutor_payable_minor", "package_contract_liability_minor", "customer_credit_liability_minor"):
        check(scenarios["SCN-RECOVERY"]["expected"][key] == ledger[key], f"Recovery checkpoint mismatch for {key}")


def main():
    check_document_links()
    for path in pack_files(".json"):
        json.loads(path.read_text(encoding="utf-8"))
    pricing = read_json("contracts/pricing-policy.json")
    policy = read_json("contracts/policy-settings.json")
    catalog = read_json("fixtures/acceptance-cases.json")
    fixtures = read_json("fixtures/domain-scenarios.json")
    check_pricing(pricing)
    check_policy(policy)
    check_acceptance(catalog, fixtures)
    check_scenario_arithmetic(fixtures)
    if ERRORS:
        for message in ERRORS:
            print("FAIL " + message)
        return 1
    print(f"PASS document links and {len(list(pack_files('.json')))} JSON files")
    print(f"PASS {len(catalog['cases'])} acceptance cases, 84 preserved IDs, 18 requirements and 13 tasks")
    print(f"PASS pricing, policy scope and selected financial oracles in the {len(fixtures['scenarios'])}-scenario fixture set")
    print("Application execution evidence is recorded separately during implementation.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"FAIL invalid pack structure or content — {error}")
        sys.exit(1)
