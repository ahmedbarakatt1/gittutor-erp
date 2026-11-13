"""Extract an authorized workbook into a private, reported-only import manifest.

The source is opened from immutable bytes and never saved. No formulas, links,
instructions, identities, financial postings or commercial policies are executed.
Only the explicit source ranges below are imported; formula-only template rows
and instructional side columns are excluded.
"""

import argparse
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
import hashlib
from io import BytesIO
import json
from pathlib import Path
import re
from xml.etree import ElementTree
from zipfile import ZipFile
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


SAFE_INTEGER = 9007199254740991
TABLE_SPECS = {
    "sessions": ("Sessions", 1, 34, {
        "date": "A P S U X", "time": "C D", "boolean": "M",
        "money": "Q R T V W Y Z AA AB AC AD AE AF", "number": "AH",
    }),
    "packages": ("Packages", 5, 39, {
        "date": "C O Q", "money": "E J K L M N P R S Y Z AA AB",
        "number": "F H I T U V W X AD AE AF AG AH AI AJ AK AL AM",
    }),
    "students": ("Students Data", 1, 7, {}),
    "tutors": ("Instructors Data", 1, 5, {"money": "C"}),
    "marketing": ("Marketing", 1, 6, {"date": "A", "money": "D"}),
    "distributions": ("Sheet2", 1, 4, {"date": "A", "number": "B", "money": "C"}),
}
BALANCE_MONEY_ROWS = (5, 6, 7, 8, 9, 10, 13, 14, 15, 16, 18, 19, 20, 21, 22, 25, 26, 27)
BALANCE_COUNT_ROWS = (30, 31, 32, 33, 34, 35)


def text_value(value):
    """Keep literal text intact; avoid adding .0 to numeric contact identifiers."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return str(value)


def normalize_value(value, value_type, issues, key):
    if value is None or value == "":
        return None
    if value_type == "text":
        return text_value(value)
    if value_type == "money":
        try:
            if isinstance(value, bool):
                raise InvalidOperation
            amount = Decimal(str(value)) * 100
            if not amount.is_finite():
                raise InvalidOperation
            if amount != amount.to_integral_value():
                issues.append(f"invalid_money_precision:{key}")
                return text_value(value)
            if abs(amount) > SAFE_INTEGER:
                issues.append(f"invalid_money_range:{key}")
                return text_value(value)
            return int(amount)
        except InvalidOperation:
            issues.append(f"invalid_money:{key}")
            return text_value(value)
    if value_type == "date":
        if isinstance(value, datetime):
            if value.time() != time(0):
                issues.append(f"invalid_date_has_time:{key}")
                return value.isoformat()
            return value.date().isoformat()
        if isinstance(value, date):
            return value.isoformat()
        if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            try:
                return date.fromisoformat(value).isoformat()
            except ValueError:
                pass
        issues.append(f"invalid_date:{key}")
        return text_value(value)
    if value_type == "time":
        if isinstance(value, time) and value.second == 0 and value.microsecond == 0 and value.tzinfo is None:
            return value.strftime("%H:%M")
        if isinstance(value, str) and re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value):
            return value
        issues.append(f"invalid_time:{key}")
        return text_value(value)
    if value_type == "number":
        if not isinstance(value, bool) and isinstance(value, (int, float)):
            decimal = Decimal(str(value))
            if decimal.is_finite() and abs(decimal) <= SAFE_INTEGER:
                return value
        issues.append(f"invalid_number:{key}")
        return text_value(value)
    if value_type == "boolean":
        if isinstance(value, bool):
            return value
        issues.append(f"invalid_boolean:{key}")
        return text_value(value)
    raise ValueError("Unknown column type")


def has_substantive_row(cells):
    return any(not is_formula and value is not None and value != "" for value, is_formula in cells)


def normalize_courses(courses):
    result = []
    seen = set()
    for value in courses:
        if not isinstance(value, str):
            continue
        label = " ".join(value.split())
        if label and label.casefold() not in seen:
            seen.add(label.casefold())
            result.append(label)
    return result


def session_instants(values, issues):
    result = {"derived_start_at": None, "derived_end_at": None}
    local_date = values.get("col_a")
    start = values.get("col_c")
    end = values.get("col_d")
    if not all(isinstance(value, str) for value in (local_date, start, end)):
        return result
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", local_date) or not all(re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value) for value in (start, end)):
        return result
    try:
        local_times = [datetime.fromisoformat(f"{local_date}T{value}:00") for value in (start, end)]
        zone = ZoneInfo("Africa/Cairo")
    except ValueError:
        return result
    except ZoneInfoNotFoundError:
        issues.append("timezone_data_unavailable")
        return result
    instants = []
    for local, key in zip(local_times, ("col_c", "col_d")):
        candidates = set()
        for fold in (0, 1):
            utc = local.replace(tzinfo=zone, fold=fold).astimezone(timezone.utc)
            if utc.astimezone(zone).replace(tzinfo=None) == local:
                candidates.add(utc)
        if not candidates:
            issues.append(f"nonexistent_cairo_time:{key}")
            return result
        if len(candidates) != 1:
            issues.append(f"ambiguous_cairo_time:{key}")
            return result
        instants.append(candidates.pop())
    if instants[1] <= instants[0]:
        # An overnight date is not stated by this workbook's single Date cell.
        issues.append("invalid_session_interval")
        return result
    return dict(zip(result, (instant.isoformat().replace("+00:00", "Z") for instant in instants)))


def missing_formula_caches(source_bytes):
    """Distinguish a cached empty string from an absent numeric formula cache."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    result = {}
    with ZipFile(BytesIO(source_bytes)) as archive:
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        relations = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {relation.attrib["Id"]: relation.attrib["Target"] for relation in relations}
        for sheet in workbook.findall("m:sheets/m:sheet", ns):
            relation = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            target = targets[relation]
            path = target.lstrip("/") if target.startswith("/") else "xl/" + target
            xml = ElementTree.fromstring(archive.read(path))
            missing = set()
            for cell in xml.findall(".//m:sheetData/m:row/m:c", ns):
                if cell.find("m:f", ns) is None:
                    continue
                cached = cell.find("m:v", ns)
                if cached is None or (cached.text is None and cell.attrib.get("t") not in ("str", "inlineStr")):
                    missing.add(cell.attrib["r"])
            result[sheet.attrib["name"]] = missing
    return result


def source_value(original, cached, kind, issues, key, missing):
    if original.coordinate in missing:
        issues.append(f"source_formula_cache_missing:{key}")
    if cached.data_type == "e":
        issues.append(f"source_error:{key}")
        return str(cached.value)
    return normalize_value(cached.value, kind, issues, key)


def add_record_issues(name, values, issues):
    required = {
        "sessions": {"col_a": "date", "col_c": "start_time", "col_d": "end_time", "col_e": "student", "col_f": "course", "col_h": "tutor"},
        "packages": {"col_a": "package_id", "col_b": "student", "col_c": "date"},
        "students": {"col_a": "student"}, "tutors": {"col_a": "tutor"},
        "marketing": {"col_a": "date"}, "distributions": {"col_a": "date", "col_d": "beneficiary"},
    }
    for key, field in required.get(name, {}).items():
        if values.get(key) is None or (isinstance(values[key], str) and not values[key].strip()):
            issues.append(f"missing_{field}:{key}")
    person_keys = {"sessions": ("col_e", "col_h"), "packages": ("col_b",), "students": ("col_a",), "tutors": ("col_a",), "distributions": ("col_d",)}
    for key in person_keys.get(name, ()):
        label = values.get(key)
        if isinstance(label, str) and re.fullmatch(r"(?:new\s+student(?:\s*\d+)?|group(?:\s*\d+)?)", label.strip(), re.IGNORECASE):
            issues.append(f"ambiguous_person:{key}")


def extract_table(name, formula_book, cached_book, missing):
    from openpyxl.utils import get_column_letter

    sheet_name, header_row, width, type_groups = TABLE_SPECS[name]
    original = formula_book[sheet_name]
    cached = cached_book[sheet_name]
    types = {letter: kind for kind, letters in type_groups.items() for letter in letters.split()}
    columns = []
    header_issues = []
    for column in range(1, width + 1):
        letter = get_column_letter(column)
        key = "col_" + letter.lower()
        cell = cached.cell(header_row, column)
        if original.cell(header_row, column).coordinate in missing[sheet_name]:
            header_issues.append(f"source_header_cache_missing:{key}")
        columns.append({"key": key, "label": text_value(cell.value) if cell.value not in (None, "") else f"Column {letter}", "type": types.get(letter, "text")})
    rows = []
    for source_row in range(header_row + 1, original.max_row + 1):
        if not has_substantive_row((original.cell(source_row, column).value, original.cell(source_row, column).data_type == "f") for column in range(1, width + 1)):
            continue
        issues = header_issues.copy()
        values = {
            column["key"]: source_value(original.cell(source_row, index), cached.cell(source_row, index), column["type"], issues, column["key"], missing[sheet_name])
            for index, column in enumerate(columns, 1)
        }
        add_record_issues(name, values, issues)
        if name == "sessions":
            values.update(session_instants(values, issues))
        rows.append({"source_row": source_row, "values": values, "issues": list(dict.fromkeys(issues))})
    if name == "sessions":
        columns.extend([
            {"key": "derived_start_at", "label": "Derived start (UTC, Africa/Cairo)", "type": "text"},
            {"key": "derived_end_at", "label": "Derived end (UTC, Africa/Cairo)", "type": "text"},
        ])
    return {"columns": columns, "rows": rows}


def extract_balances(formula_book, cached_book, missing):
    columns = [
        {"key": "source_sheet", "label": "Source sheet", "type": "text"},
        {"key": "source_cell", "label": "Source cell", "type": "text"},
        {"key": "label", "label": "Workbook label", "type": "text"},
        {"key": "reported_amount_minor", "label": "Workbook reported amount (EGP)", "type": "money"},
        {"key": "reported_count", "label": "Workbook reported count", "type": "number"},
    ]
    rows = []
    sources = [("Settings", 3, "money")] + [("Dashboard", row, "money") for row in BALANCE_MONEY_ROWS] + [("Dashboard", row, "number") for row in BALANCE_COUNT_ROWS]
    for sheet, row, kind in sources:
        label = cached_book[sheet].cell(row, 1).value
        if label is None:
            raise ValueError(f"Expected balance label missing at {sheet}!A{row}")
        issues = []
        key = "reported_amount_minor" if kind == "money" else "reported_count"
        cell = cached_book[sheet].cell(row, 2)
        values = {"source_sheet": sheet, "source_cell": cell.coordinate, "label": text_value(label), "reported_amount_minor": None, "reported_count": None}
        values[key] = source_value(formula_book[sheet].cell(row, 2), cell, kind, issues, key, missing[sheet])
        rows.append({"source_row": row, "values": values, "issues": issues})
    return {"columns": columns, "rows": rows}


def extract_workbook(source):
    import openpyxl

    source_bytes = source.read_bytes()
    formula_book = openpyxl.load_workbook(BytesIO(source_bytes), data_only=False, keep_links=False)
    cached_book = openpyxl.load_workbook(BytesIO(source_bytes), data_only=True, keep_links=False)
    missing = missing_formula_caches(source_bytes)
    try:
        tables = {name: extract_table(name, formula_book, cached_book, missing) for name in TABLE_SPECS}
        tables["balances"] = extract_balances(formula_book, cached_book, missing)
    finally:
        formula_book.close()
        cached_book.close()
    # Catalog observations come from explicit session Course cells, never instructions
    # or guessed splits of the free-text "Current Courses" student field.
    courses = normalize_courses(row["values"]["col_f"] for row in tables["sessions"]["rows"] if "source_error:col_f" not in row["issues"])
    return {
        "version": 1, "source_name": source.name, "source_sha256": hashlib.sha256(source_bytes).hexdigest(),
        "as_of": None, "tables": tables, "courses": courses,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / ".local" / "workflow-import" / "workflow-snapshot.json")
    args = parser.parse_args()
    private_root = Path(__file__).resolve().parents[1] / ".local" / "workflow-import"
    output = args.output.resolve()
    if not output.is_relative_to(private_root.resolve()) or output.suffix != ".json" or output == args.source.resolve():
        parser.error("Output must be a JSON file inside the project's ignored .local/workflow-import directory")
    snapshot = extract_workbook(args.source)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    # Diagnostics deliberately contain counts only, never names, contacts or amounts.
    print(json.dumps({"output": str(output), "counts": {name: len(table["rows"]) for name, table in snapshot["tables"].items()}, "course_count": len(snapshot["courses"]), "flagged_records": sum(bool(row["issues"]) for table in snapshot["tables"].values() for row in table["rows"])}))


if __name__ == "__main__":
    main()
