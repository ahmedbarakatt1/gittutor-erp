import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requestSupabase } from '@/server/supabase';
import { allowedOrigin, DomainError, readJson, safeError } from '@/server/http';
import { analyticsCommands, cohortCsv, cohortFilters, getCohortReport, getWorkloadReport, invokeAnalyticsCommand, listAnalyticsInquiries, listCampaigns, type CohortReport } from '@/modules/analytics/queries';
import { paymentRpc } from '@/modules/payments/commands';
import { streamFileBytes } from '@/server/file-content-body';
export const runtime = 'nodejs';
const rangeFields = ['from', 'to', 'as_of', 'observation_days', 'campaign_id', 'source', 'format', 'subject_id', 'policy_version', 'cursor', 'limit'];
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  let scoped: ReturnType<typeof requestSupabase> | undefined; const requestId = randomUUID();
  try {
    scoped = requestSupabase(request); const claims = await scoped.client.auth.getClaims();
    if (claims.error || !claims.data?.claims.sub) throw new DomainError('AUTH_REQUIRED');
    const path = (await context.params).path.join('/'), params = request.nextUrl.searchParams;
    const allowed = path === 'campaigns' ? ['cursor', 'limit'] : path === 'inquiries' ? ['learner_id', 'cursor', 'limit'] : path === 'workload' ? ['from', 'to', 'tutor_cursor', 'conversation_cursor', 'limit'] : rangeFields;
    if ([...params.keys()].some(field => !allowed.includes(field) || params.getAll(field).length !== 1)) throw new DomainError('VALIDATION_ERROR');
    const args = Object.fromEntries([...params].map(([field, value]) => [`p_${field}`, ['limit', 'observation_days'].includes(field) ? Number(value) : value || null]));
    let data: unknown;
    if (request.method === 'GET') {
      if (path === 'campaigns') data = await listCampaigns(scoped.client, args);
      else if (path === 'inquiries') data = await listAnalyticsInquiries(scoped.client, args);
      else if (path === 'cohorts') data = await getCohortReport(scoped.client, args);
      else if (path === 'workload') data = await getWorkloadReport(scoped.client, args);
      else throw new DomainError('NOT_FOUND');
    } else {
      if (!allowedOrigin(request.headers.get('origin'), scoped.config.app_base_url, scoped.config.isolated)) throw new DomainError('FORBIDDEN');
      if (path === 'cohorts/export') {
        const parsed = cohortFilters.parse(args); if (parsed.p_cursor !== null) throw new DomainError('VALIDATION_ERROR');
        let report = await getCohortReport(scoped.client, { ...parsed, p_limit: 100 }); const rows: CohortReport['items'] = [...report.items];
        const expected = report.summary;
        while (report.next_cursor) { report = await getCohortReport(scoped.client, { ...parsed, p_limit: 100, p_cursor: report.next_cursor }); rows.push(...report.items); if (rows.length > 10000) throw new DomainError('VALIDATION_ERROR'); }
        if (rows.length !== expected.learners || rows.filter(row => row.newly_taught).length !== expected.newly_taught) throw new DomainError('STATE_CONFLICT');
        const filters = Object.fromEntries(Object.entries(parsed).filter(([field]) => !['p_limit', 'p_cursor', 'p_policy_version'].includes(field)).map(([field, value]) => [field.slice(2), value]));
        const audit = z.object({ audit_id: z.uuid() }).strict().parse((await paymentRpc(scoped.client, 'audit_cohort_export', { p_filters: filters, p_row_count: rows.length, p_newly_taught_count: expected.newly_taught })).data);
        return scoped.finish(new NextResponse(streamFileBytes(new TextEncoder().encode(cohortCsv(rows))), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="cohort-${parsed.p_from}-${parsed.p_to}.csv"`, 'Cache-Control': 'private, no-store', 'X-Export-Audit': audit.audit_id, 'X-Content-Type-Options': 'nosniff' } }));
      }
      if (params.size || !Object.hasOwn(analyticsCommands, path)) throw new DomainError('NOT_FOUND');
      const body = await readJson(request), idempotencyKey = request.headers.get('Idempotency-Key');
      if (!body || typeof body !== 'object' || Array.isArray(body) || !idempotencyKey || Object.hasOwn(body, 'idempotency_key')) throw new DomainError('VALIDATION_ERROR');
      data = (await invokeAnalyticsCommand(scoped.client, path as keyof typeof analyticsCommands, { ...Object.fromEntries(Object.entries(body).map(([field, value]) => [`p_${field}`, value])), p_idempotency_key: idempotencyKey })).data;
    }
    return scoped.finish(NextResponse.json({ data, request_id: requestId }, { headers: { 'Cache-Control': 'private, no-store' } }));
  } catch (error) {
    const safe = safeError(error instanceof z.ZodError ? new DomainError('VALIDATION_ERROR') : error), response = NextResponse.json({ ...safe, request_id: requestId }, { status: safe.status, headers: { 'Cache-Control': 'private, no-store' } });
    return scoped ? scoped.finish(response) : response;
  }
}
export const GET = handle;
export const POST = handle;
