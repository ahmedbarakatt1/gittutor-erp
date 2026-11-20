import { invokePayrollCommandWithStatus, type payrollCommands } from "@/modules/tutor_pay/payroll";
import { payrollCommandRoutes, findPayrollReadRoute } from "@/server/payroll-http";
import { payoutDestinationServer } from "@/server/payout-destination-server";
import { invokeFinanceCommand, type financeCommands } from "@/modules/analytics/finance";
import { financeCommandRoutes, findFinanceReadRoute } from "@/server/finance-http";
import { invokeTeachingCommandWithStatus as invokeTeachingOperation, type teachingCommands as teachingOperations } from "@/modules/teaching/operations";
import { teachingOperationRoutes, findTeachingOperationReadRoute } from "@/server/teaching-operations-http";
import { invokeTeachingCommandWithStatus as invokeDeliveryCommand, type TeachingCommandName as DeliveryCommandName } from "@/modules/teaching/commands";
import { deliveryCommandRoutes, findDeliveryReadRoute } from "@/server/delivery-http";
import { randomUUID } from "node:crypto";
import { invokeMeetingCommandWithStatus, type meetingCommands } from "@/modules/teaching/meetings";
import { meetingCommandRoutes, findMeetingReadRoute } from "@/server/meeting-http";
import { invokeFileCommandWithStatus, type FileCommandName } from "@/modules/files/commands";
import { fileCommandRoutes, findFileReadRoute } from "@/server/file-http";
import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { allowedOrigin, DomainError, readJson, safeError } from "@/server/http";
import { invokeIdentityCommandWithStatus, type IdentityCommandName } from "@/modules/identity/commands";
import { getApplicationSubjects, getLearnerSummary, getMyGuardianLinks, getMyVerifiedContacts, getStaffInvitations, getStaffRoleGrants, getTutorApplications, getTutorProfile } from "@/modules/identity/queries";
import { invokeCatalogCommandWithStatus, type CatalogCommandName } from "@/modules/catalog/commands";
import { getPublicTutor, listAdminOffers, listAdminTutors, listPolicies, listPricingVersions, listPublicOffers } from "@/modules/catalog/queries";
import { invokeBookingCommandWithStatus, type BookingCommandName } from "@/modules/booking/commands";
import { invokeEnrollmentTransferCommand, type EnrollmentTransferCommandName } from "@/modules/booking/enrollment-transfers";
import { enrollmentTransferCommandRoutes, findEnrollmentTransferReadRoute } from "@/server/enrollment-transfer-http";
import {
  getAdminTutorAvailability, getEnrollment, getGroupAmendment, getOperationProposal, getQuote, getTutorAvailability,
  listAdminFeeAgreements, listAdminOccurrences, listBookingLearners, listMyBookingLearners, listMyEnrollments,
  listMyWaitlist, listOfferOccurrences, listTutorFeeAgreements, listTutorOccurrences,
} from "@/modules/booking/queries";
import { invokePackageCommandWithStatus, type PackageCommandName } from "@/modules/packages/commands";
import { invokePaymentCommandWithStatus, type PaymentCommandName } from "@/modules/payments/commands";
import { findPaymentReadRoute, paymentCommandRoutes } from "@/server/payment-http";
import { lookupTransferPayer } from "@/modules/payments/queries";
import { refundDestinationServer } from "@/server/refund-destination-server";
import {
  getMyPackage, getPackageContract, getPackageCoverageOptions, getPackageReconciliation,
  listAdminPackages, listMyPackageLearners, listMyPackages, listPackageContracts, listPackageCoverage,
  listPackageEnrollments, listPackageGrantPolicies, listPackageLineage, listPackageLots,
  listPackageMovements, listPackageOperationProposals, listPackageRenewals,
} from "@/modules/packages/queries";

type CommandRoute = { pattern: RegExp; fields: string[]; pathArgument?: string } & (
  { family?: "identity"; rpc: IdentityCommandName } | { family: "catalog"; rpc: CatalogCommandName } | { family: "booking"; rpc: BookingCommandName } | { family: "packages"; rpc: PackageCommandName } | { family: "payments"; rpc: PaymentCommandName } | { family: "enrollment-transfer"; rpc: EnrollmentTransferCommandName } | { family: "files"; rpc: FileCommandName } | { family: "meetings"; rpc: keyof typeof meetingCommands } | { family: "delivery"; rpc: DeliveryCommandName } | { family: "finance"; rpc: keyof typeof financeCommands } | { family: "payroll"; rpc: keyof typeof payrollCommands } | { family: "teaching-operations"; rpc: keyof typeof teachingOperations }
);
const commands: CommandRoute[] = [
  ...paymentCommandRoutes,
  ...enrollmentTransferCommandRoutes,
  ...fileCommandRoutes,
  ...meetingCommandRoutes,
  ...deliveryCommandRoutes,
  ...financeCommandRoutes,
  ...payrollCommandRoutes,
  ...teachingOperationRoutes,
  { family: "packages", pattern: /^packages$/, rpc: "purchase_package", fields: ["learner_id", "package_contract_version_id", "accepted_terms_hash"] },
  { family: "packages", pattern: /^packages\/([^/]+)\/complimentary-grants$/, rpc: "approve_package_grant", pathArgument: "package_id", fields: ["credit_quanta", "carrying_value_minor", "currency", "grant_kind", "grant_policy_version_id", "source_credit_id", "credit_conversion_intent_id", "reason", "evidence_file_id", "expected_version"] },
  { family: "packages", pattern: /^packages\/([^/]+)\/reserve$/, rpc: "reserve_package_credit", pathArgument: "package_id", fields: ["enrollment_id", "credit_quanta", "coverage_proposal_id", "expected_version"] },
  { family: "packages", pattern: /^package-reservations\/([^/]+)\/release$/, rpc: "release_package_reservation", pathArgument: "reservation_id", fields: ["reason", "expected_version"] },
  { family: "packages", pattern: /^packages\/([^/]+)\/renew$/, rpc: "renew_package", pathArgument: "package_id", fields: ["new_contract_version_id", "transfer_credit_quanta", "accepted_terms_hash", "conversion_proposal_id", "expected_version"] },
  { family: "packages", pattern: /^packages\/([^/]+)\/transfers$/, rpc: "transfer_package_credit", pathArgument: "package_id", fields: ["target_package_id", "credit_quanta", "conversion_proposal_id", "reason", "expected_version", "expected_target_version"] },
  { family: "packages", pattern: /^package-consumptions\/([^/]+)\/restore$/, rpc: "restore_package_credit", pathArgument: "consumption_id", fields: ["credit_quanta", "remedy_id", "reason", "expected_version"] },
  { family: "packages", pattern: /^package-grant-policies$/, rpc: "create_package_grant_policy", fields: ["content"] },
  { family: "packages", pattern: /^package-grant-policies\/([^/]+)\/approve$/, rpc: "approve_package_grant_policy", pathArgument: "grant_policy_version_id", fields: ["effective_at", "approval_note", "expected_version"] },
  { pattern: /^guardian-invitations$/, rpc: "create_guardian_invitation", fields: ["contact_id", "scopes", "expires_at"] },
  { pattern: /^guardian-invitations\/([^/]+)\/accept$/, rpc: "accept_guardian_invitation", pathArgument: "invitation_id", fields: ["single_use_token", "expected_version"] },
  { pattern: /^guardian-links\/([^/]+)\/revoke$/, rpc: "revoke_guardian_link", pathArgument: "guardian_link_id", fields: ["reason", "expected_version"] },
  { pattern: /^staff-role-grants$/, rpc: "grant_staff_role", fields: ["account_id", "role", "reason"] },
  { pattern: /^staff-role-grants\/([^/]+)\/revoke$/, rpc: "revoke_staff_role", pathArgument: "role_grant_id", fields: ["reason", "expected_version"] },
  { pattern: /^staff-invitations$/, rpc: "create_staff_invitation", fields: ["email", "role", "reason", "expires_at"] },
  { pattern: /^staff-invitations\/([^/]+)\/accept$/, rpc: "accept_staff_invitation", pathArgument: "invitation_id", fields: ["expected_version"] },
  { pattern: /^tutor-applications$/, rpc: "submit_tutor_application", fields: ["display_name", "subject_ids", "bio", "contact_id"] },
  { pattern: /^tutor-applications\/([^/]+)\/review$/, rpc: "review_tutor_application", pathArgument: "application_id", fields: ["decision", "reason", "approved_subject_ids", "expected_version"] },
  { pattern: /^tutor\/profile$/, rpc: "update_tutor_profile", fields: ["display_name", "bio", "subject_ids", "contact_id", "locale", "expected_version"] },
  { family: "catalog", pattern: /^policies$/, rpc: "create_policy_draft", fields: ["kind", "scope", "content"] },
  { family: "catalog", pattern: /^policies\/([^/]+)\/update$/, rpc: "update_policy_draft", pathArgument: "policy_version_id", fields: ["content", "expected_version"] },
  { family: "catalog", pattern: /^policies\/([^/]+)\/approve$/, rpc: "approve_policy_version", pathArgument: "policy_version_id", fields: ["effective_at", "approval_note", "expected_version"] },
  { family: "catalog", pattern: /^pricing-versions$/, rpc: "create_pricing_draft", fields: ["scope", "customer_pricing", "compensation"] },
  { family: "catalog", pattern: /^pricing-versions\/([^/]+)\/update$/, rpc: "update_pricing_draft", pathArgument: "pricing_version_id", fields: ["customer_pricing", "compensation", "expected_version"] },
  { family: "catalog", pattern: /^pricing-versions\/([^/]+)\/approve$/, rpc: "approve_pricing_version", pathArgument: "pricing_version_id", fields: ["effective_at", "approval_note", "expected_version"] },
  { family: "catalog", pattern: /^offers$/, rpc: "create_offer", fields: ["subject_id", "format", "duration_minutes", "capacity", "target_tier", "pricing_version_id", "policy_version_id"] },
  { family: "catalog", pattern: /^offers\/([^/]+)\/publish$/, rpc: "publish_offer", pathArgument: "offer_id", fields: ["effective_at", "expected_version"] },
  { family: "catalog", pattern: /^tutor-profiles\/([^/]+)\/approve$/, rpc: "approve_tutor_profile", pathArgument: "tutor_id", fields: ["profile_version_id", "decision", "reason", "expected_version"] },
  { family: "booking", pattern: /^availability$/, rpc: "set_availability", fields: ["tutor_id", "weekly_intervals", "dated_exceptions", "reason", "expected_version"] },
  { family: "booking", pattern: /^occurrences$/, rpc: "create_occurrence", fields: ["offer_id", "tutor_id", "start_at", "end_at", "time_zone", "target_tier"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/holds$/, rpc: "reserve_enrollment", pathArgument: "occurrence_id", fields: ["learner_id"] },
  { family: "booking", pattern: /^quotes\/([^/]+)\/accept$/, rpc: "accept_quote", pathArgument: "quote_id", fields: ["quote_hash", "expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/confirm$/, rpc: "confirm_occurrence", pathArgument: "occurrence_id", fields: ["expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/capacity$/, rpc: "change_occurrence_capacity", pathArgument: "occurrence_id", fields: ["capacity", "reason", "expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/waitlist$/, rpc: "join_waitlist", pathArgument: "occurrence_id", fields: ["learner_id"] },
  { family: "booking", pattern: /^waitlist\/([^/]+)\/leave$/, rpc: "leave_waitlist", pathArgument: "waitlist_entry_id", fields: ["expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/fee-agreements$/, rpc: "approve_tutor_fee", pathArgument: "occurrence_id", fields: ["tutor_id", "fee_minor", "currency", "duration_minutes", "compensation_policy_version_id", "target_tier", "purpose", "reason", "expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/amendments$/, rpc: "propose_group_amendment", pathArgument: "occurrence_id", fields: ["add_learner_ids", "remove_enrollment_ids", "target_tier", "fee_agreement_id", "replacement_policy_version_id", "package_dispositions", "removed_remedy", "expires_at", "reason", "expected_version"] },
  { family: "booking", pattern: /^amendments\/([^/]+)\/accept$/, rpc: "accept_group_amendment", pathArgument: "amendment_id", fields: ["terms_hash", "expected_version"] },
  { family: "booking", pattern: /^amendments\/([^/]+)\/decline$/, rpc: "decline_group_amendment", pathArgument: "amendment_id", fields: ["reason", "expected_version"] },
  { family: "booking", pattern: /^amendments\/([^/]+)\/commit$/, rpc: "commit_group_amendment", pathArgument: "amendment_id", fields: ["expected_version"] },
  { family: "booking", pattern: /^operation-proposals$/, rpc: "create_operation_proposal", fields: ["kind", "target_id", "requested_terms", "reason", "expected_version"] },
  { family: "booking", pattern: /^operation-proposals\/([^/]+)\/accept$/, rpc: "accept_operation_proposal", pathArgument: "proposal_id", fields: ["terms_hash", "expected_version"] },
  { family: "booking", pattern: /^operation-proposals\/([^/]+)\/decline$/, rpc: "decline_operation_proposal", pathArgument: "proposal_id", fields: ["reason", "expected_version"] },
  { family: "booking", pattern: /^operation-proposals\/([^/]+)\/revise-cancellation$/, rpc: "revise_cancellation_proposal", pathArgument: "proposal_id", fields: ["tutor_compensation_minor", "package_dispositions", "reason", "expected_version"] },
  { family: "booking", pattern: /^operation-proposals\/([^/]+)\/approve$/, rpc: "approve_operation_proposal", pathArgument: "proposal_id", fields: ["terms_hash", "decision", "reason", "expected_version"] },
  { family: "booking", pattern: /^enrollments\/([^/]+)\/cancel$/, rpc: "cancel_enrollment", pathArgument: "enrollment_id", fields: ["reason", "remedy_proposal_id", "expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/reschedule$/, rpc: "reschedule_occurrence", pathArgument: "occurrence_id", fields: ["start_at", "end_at", "time_zone", "reason", "accepted_proposal_id", "expected_version"] },
  { family: "booking", pattern: /^occurrences\/([^/]+)\/cancel$/, rpc: "cancel_occurrence", pathArgument: "occurrence_id", fields: ["reason", "remedy_proposal_id", "expected_version"] },
  { family: "booking", pattern: /^enrollments\/([^/]+)\/transfer$/, rpc: "transfer_enrollment", pathArgument: "enrollment_id", fields: ["destination_occurrence_id", "accepted_proposal_id", "expected_version"] },
];

export async function POST(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    const path = (await params).path.join("/");
    const route = commands.find(item => item.pattern.test(path));
    const payerLookup = /^incoming-transfers\/([^/]+)\/payer-lookup$/.exec(path);
    const destinationReveal = /^refund-destinations\/([^/]+)\/reveal$/.exec(path);
    const payoutReveal = /^payout-destinations\/([^/]+)\/reveal$/.exec(path);
    if (!route && !payerLookup && !destinationReveal && !payoutReveal) throw new DomainError("NOT_FOUND");
    context = requestSupabase(request);
    if (!allowedOrigin(request.headers.get("origin"), context.config.app_base_url, context.config.isolated)) throw new DomainError("FORBIDDEN");
    const { data, error } = await context.client.auth.getClaims();
    if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
    if (payerLookup) {
      if (request.nextUrl.searchParams.size) throw new DomainError("VALIDATION_ERROR");
      const body = await readJson(request);
      const result = await lookupTransferPayer(context.client, payerLookup[1], body as Parameters<typeof lookupTransferPayer>[2]);
      return context.finish(NextResponse.json({ data: result, request_id: requestId }));
    }
    if (payoutReveal) {
      if (request.nextUrl.searchParams.size) throw new DomainError("VALIDATION_ERROR");
      const body = await readJson(request);
      if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(field => !["payout_attempt_id", "reason"].includes(field))) throw new DomainError("VALIDATION_ERROR");
      const result = await payoutDestinationServer(context.client, data.claims, context.config).reveal({ ...body, destination_id: payoutReveal[1] });
      return context.finish(NextResponse.json({ data: result, request_id: requestId }, { headers: { "Pragma": "no-cache" } }));
    }
    if (destinationReveal) {
      if (request.nextUrl.searchParams.size) throw new DomainError("VALIDATION_ERROR");
      const body = await readJson(request);
      if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(field => !["refund_attempt_id", "reason"].includes(field))) throw new DomainError("VALIDATION_ERROR");
      const result = await refundDestinationServer(context.client, data.claims, context.config).reveal({ ...body, destination_id: destinationReveal[1] });
      return context.finish(NextResponse.json({ data: result, request_id: requestId }, { headers: { "Pragma": "no-cache" } }));
    }
    if (!route) throw new DomainError("NOT_FOUND");
    const key = request.headers.get("Idempotency-Key");
    if (!key || !key.trim() || key.length > 200) throw new DomainError("VALIDATION_ERROR");
    const body = await readJson(request);
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(field => !route.fields.includes(field))) throw new DomainError("VALIDATION_ERROR");
    const args: Record<string, unknown> = { p_idempotency_key: key };
    for (const [field, value] of Object.entries(body)) args[`p_${field}`] = value;
    if (route.pathArgument) args[`p_${route.pathArgument}`] = route.pattern.exec(path)![1];
    const result = route.family === "payments" && route.rpc === "propose_refund_destination"
      ? await refundDestinationServer(context.client, data.claims, context.config).propose(args)
      : route.family === "payments" && route.rpc === "verify_refund_destination"
      ? await refundDestinationServer(context.client, data.claims, context.config).verify(args)
      : route.family === "payments"
      ? await invokePaymentCommandWithStatus(context.client, route.rpc, args)
      : route.family === "packages"
      ? await invokePackageCommandWithStatus(context.client, route.rpc, args)
      : route.family === "teaching-operations"
        ? await invokeTeachingOperation(context.client, route.rpc, args)
      : route.family === "payroll" && route.rpc === "submit_payout_destination"
        ? await payoutDestinationServer(context.client, data.claims, context.config).submit(args)
      : route.family === "payroll" && route.rpc === "verify_payout_destination"
        ? await payoutDestinationServer(context.client, data.claims, context.config).verify(args)
      : route.family === "payroll"
        ? await invokePayrollCommandWithStatus(context.client, route.rpc, args)
      : route.family === "finance"
        ? await invokeFinanceCommand(context.client, route.rpc, args)
      : route.family === "delivery"
        ? await invokeDeliveryCommand(context.client, route.rpc, args)
      : route.family === "meetings"
      ? await invokeMeetingCommandWithStatus(context.client, route.rpc, args)
      : route.family === "files"
      ? await invokeFileCommandWithStatus(context.client, route.rpc, args)
      : route.family === "enrollment-transfer"
      ? await invokeEnrollmentTransferCommand(context.client, route.rpc, args)
      : route.family === "booking"
      ? await invokeBookingCommandWithStatus(context.client, route.rpc, args)
      : route.family === "catalog"
      ? await invokeCatalogCommandWithStatus(context.client, route.rpc, args)
      : await invokeIdentityCommandWithStatus(context.client, route.rpc, args);
    return context.finish(NextResponse.json({ data: result.data, request_id: requestId }, { status: result.status }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId, ...(safe.field_errors ? { field_errors: safe.field_errors } : {}) }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const requestId = randomUUID();
  let context: ReturnType<typeof requestSupabase> | undefined;
  try {
    const path = (await params).path;
    const route = path.join("/");
    const paymentRead = findPaymentReadRoute(route) || findEnrollmentTransferReadRoute(route) || findFileReadRoute(route) || findMeetingReadRoute(route) || findPayrollReadRoute(route) || findFinanceReadRoute(route) || findDeliveryReadRoute(route) || findTeachingOperationReadRoute(route);
    if (paymentRead) {
      const filters = request.nextUrl.searchParams;
      if (Array.from(filters.keys()).some(key => !paymentRead.fields.includes(key)) || new Set(filters.keys()).size !== filters.size) throw new DomainError("VALIDATION_ERROR");
      const options: Record<string, unknown> = Object.fromEntries(filters);
      if (filters.has("limit")) options.limit = Number(filters.get("limit"));
      context = requestSupabase(request);
      const { data, error } = await context.client.auth.getClaims();
      if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
      return context.finish(NextResponse.json({ data: await paymentRead.run(context.client, options), request_id: requestId }));
    }
    const queryFields: Record<string, string[]> = {
      "tutor-applications": ["cursor", "limit"], "staff-invitations": ["cursor", "limit"],
      "staff-role-grants": ["cursor", "limit"], "me/guardian-links": ["cursor", "limit"],
      "public/offers": ["offer_id", "subject_id", "format", "from", "to", "cursor", "limit"],
      policies: ["kind", "scope", "status", "cursor", "limit"],
      "pricing-versions": ["format", "status", "cursor", "limit"],
      offers: ["format", "status", "cursor", "limit"], tutors: ["subject_id", "active", "cursor", "limit"],
      "booking/occurrences": ["offer_id", "occurrence_id", "from", "to", "cursor", "limit"],
      "me/learners": ["cursor", "limit"], "booking/learners": ["q", "cursor", "limit"],
      "me/enrollments": ["learner_id", "from", "to", "state", "cursor", "limit"],
      "me/waitlist": ["learner_id", "state", "cursor", "limit"],
      "tutor/fee-agreements": ["from", "to", "cursor", "limit"],
      "tutor/occurrences": ["occurrence_id", "from", "to", "state", "cursor", "limit"],
      occurrences: ["occurrence_id", "from", "to", "state", "format", "tutor_id", "cursor", "limit"],
      "me/package-learners": ["cursor", "limit"],
      "me/package-contracts": ["learner_id", "offer_id", "cursor", "limit"],
      "me/packages": ["learner_id", "cursor", "limit"],
      "admin/packages": ["learner_id", "purchase_state", "cursor", "limit"],
      "package-grant-policies": ["status", "cursor", "limit"],
      "package-enrollments": ["learner_id", "state", "cursor", "limit"],
      "package-proposals": ["learner_id", "state", "cursor", "limit"],
    };
    const dynamicQueryFields = path.length === 3 && path[0] === "occurrences" && path[2] === "fee-agreements"
      ? ["cursor", "limit"] : path.length === 2 && ["amendments", "operation-proposals"].includes(path[0])
        ? ["view", "learner_id"]
        : path.length === 2 && path[0] === "package-contracts" ? ["learner_id"]
          : path.length === 3 && path[0] === "enrollments" && path[2] === "package-options" ? ["package_id", "credit_quanta", "cursor", "limit"]
            : path.length === 3 && path[0] === "packages" && ["lots", "movements", "coverage", "lineage", "renewals"].includes(path[2]) ? ["cursor", "limit"] : [];
    const filters = request.nextUrl.searchParams;
    if (Array.from(filters.keys()).some(key => !(queryFields[route] || dynamicQueryFields).includes(key)) || new Set(filters.keys()).size !== filters.size) throw new DomainError("VALIDATION_ERROR");
    const pageOptions = { cursor: filters.get("cursor"), limit: filters.has("limit") ? Number(filters.get("limit")) : 25 };
    const options: Record<string, unknown> = { ...Object.fromEntries(filters), ...pageOptions };
    if (filters.has("credit_quanta")) options.credit_quanta = Number(filters.get("credit_quanta"));
    if (filters.has("active")) {
      if (!["true", "false"].includes(filters.get("active")!)) throw new DomainError("VALIDATION_ERROR");
      options.active = filters.get("active") === "true";
    }
    context = requestSupabase(request);
    const { data, error } = await context.client.auth.getClaims();
    if (error || !data?.claims.sub) throw new DomainError("AUTH_REQUIRED");
    if (route === "public/offers") {
      return context.finish(NextResponse.json({ data: await listPublicOffers(context.client, options), request_id: requestId }));
    }
    if (path.length === 3 && path[0] === "public" && path[1] === "tutors") {
      return context.finish(NextResponse.json({ data: await getPublicTutor(context.client, path[2]), request_id: requestId }));
    }
    if (path[0] === "public") throw new DomainError("NOT_FOUND");
    let result: unknown;
    if (route === "me/package-learners") result = await listMyPackageLearners(context.client, pageOptions);
    else if (route === "me/package-contracts") result = await listPackageContracts(context.client, { ...options, learner_id: filters.get("learner_id") || "" });
    else if (route === "me/packages") result = await listMyPackages(context.client, options);
    else if (route === "admin/packages") result = await listAdminPackages(context.client, options);
    else if (route === "package-grant-policies") result = await listPackageGrantPolicies(context.client, options);
    else if (route === "package-enrollments") result = await listPackageEnrollments(context.client, { ...options, learner_id: filters.get("learner_id") || "" });
    else if (route === "package-proposals") result = await listPackageOperationProposals(context.client, options);
    else if (path.length === 2 && path[0] === "package-contracts") result = await getPackageContract(context.client, path[1], filters.get("learner_id") || "");
    else if (path.length === 2 && path[0] === "packages") result = await getMyPackage(context.client, path[1]);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "lots") result = await listPackageLots(context.client, path[1], pageOptions);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "movements") result = await listPackageMovements(context.client, path[1], pageOptions);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "coverage") result = await listPackageCoverage(context.client, path[1], pageOptions);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "lineage") result = await listPackageLineage(context.client, path[1], pageOptions);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "renewals") result = await listPackageRenewals(context.client, path[1], pageOptions);
    else if (path.length === 3 && path[0] === "packages" && path[2] === "reconciliation") result = await getPackageReconciliation(context.client, path[1]);
    else if (path.length === 3 && path[0] === "enrollments" && path[2] === "package-options") result = await getPackageCoverageOptions(context.client, path[1], options);
    else if (path.join("/") === "tutor/profile") result = await getTutorProfile(context.client);
    else if (path.join("/") === "me/contacts") result = await getMyVerifiedContacts(context.client);
    else if (path.join("/") === "me/application-subjects") result = await getApplicationSubjects(context.client);
    else if (path.join("/") === "tutor-applications") result = await getTutorApplications(context.client, pageOptions);
    else if (path.join("/") === "staff-invitations") result = await getStaffInvitations(context.client, pageOptions);
    else if (path.join("/") === "staff-role-grants") result = await getStaffRoleGrants(context.client, pageOptions);
    else if (path.join("/") === "me/guardian-links") result = await getMyGuardianLinks(context.client, pageOptions);
    else if (route === "policies") result = await listPolicies(context.client, options);
    else if (route === "pricing-versions") result = await listPricingVersions(context.client, options);
    else if (route === "offers") result = await listAdminOffers(context.client, options);
    else if (route === "tutors") result = await listAdminTutors(context.client, options);
    else if (route === "me/learners") result = await listMyBookingLearners(context.client, pageOptions);
    else if (route === "booking/learners") result = await listBookingLearners(context.client, options);
    else if (route === "booking/occurrences") result = await listOfferOccurrences(context.client, { ...options, offer_id: filters.get("offer_id") || "" });
    else if (route === "me/enrollments") result = await listMyEnrollments(context.client, options);
    else if (route === "me/waitlist") result = await listMyWaitlist(context.client, options);
    else if (route === "tutor/availability") result = await getTutorAvailability(context.client);
    else if (route === "tutor/fee-agreements") result = await listTutorFeeAgreements(context.client, options);
    else if (route === "tutor/occurrences") result = await listTutorOccurrences(context.client, options);
    else if (route === "occurrences") result = await listAdminOccurrences(context.client, options);
    else if (path.length === 3 && path[0] === "tutors" && path[2] === "availability") result = await getAdminTutorAvailability(context.client, path[1]);
    else if (path.length === 3 && path[0] === "occurrences" && path[2] === "fee-agreements") result = await listAdminFeeAgreements(context.client, path[1], pageOptions);
    else if (path.length === 2 && path[0] === "enrollments") result = await getEnrollment(context.client, path[1]);
    else if (path.length === 2 && path[0] === "quotes") result = await getQuote(context.client, path[1]);
    else if (path.length === 2 && path[0] === "operation-proposals") result = await getOperationProposal(context.client, path[1], Object.fromEntries(filters));
    else if (path.length === 2 && path[0] === "amendments") result = await getGroupAmendment(context.client, path[1], Object.fromEntries(filters));
    else if (path.length === 2 && path[0] === "learners") result = await getLearnerSummary(context.client, path[1]);
    else throw new DomainError("NOT_FOUND");
    return context.finish(NextResponse.json({ data: result, request_id: requestId }));
  } catch (error) {
    const safe = safeError(error);
    const response = NextResponse.json({ code: safe.code, message: safe.message, request_id: requestId, ...(safe.field_errors ? { field_errors: safe.field_errors } : {}) }, { status: safe.status, headers: { "Cache-Control": "private, no-store" } });
    return context ? context.finish(response) : response;
  }
}
