export const historicalCatalogCutoff = '20261111123430';
export const historicalBootstrapSource = 'local-historical-catalog-v1';
export type HistoricalBootstrapClaim = {
  source_version: typeof historicalBootstrapSource;
  cutoff: typeof historicalCatalogCutoff;
  stage: 'claimed' | 'catalog_seeded' | 'complete';
};

/** A durable claim records that this project was empty before synthetic seeding began. */
export function chooseLocalBootstrapPlan(state: {
  environment: string; fixture_marker: string; applied_versions: string[];
  auth_users: number; has_domain_data: boolean; claim: unknown;
}): 'start_historical_seed' | 'resume_historical_seed' | 'append' {
  if (state.environment !== 'test' || state.fixture_marker !== 'git-tutor-supabase-local-v1'
    || !Number.isSafeInteger(state.auth_users) || state.auth_users < 0
    || state.applied_versions.some(version => !/^\d{14}$/.test(version))) throw new Error('LOCAL_SUPABASE_REQUIRED');
  const afterCutoff = state.applied_versions.some(version => version > historicalCatalogCutoff);
  if (state.claim !== null) {
    const claim = state.claim as Partial<HistoricalBootstrapClaim> | null;
    if (!claim || claim.source_version !== historicalBootstrapSource || claim.cutoff !== historicalCatalogCutoff
      || !['claimed', 'catalog_seeded', 'complete'].includes(claim.stage || '')) throw new Error('LOCAL_BOOTSTRAP_STAGE_INVALID');
    if (claim.stage !== 'claimed') return 'append';
    if (afterCutoff) throw new Error('LOCAL_BOOTSTRAP_STAGE_CONFLICT');
    return 'resume_historical_seed';
  }
  if (state.auth_users || state.has_domain_data) return 'append';
  if (afterCutoff) throw new Error('HISTORICAL_CATALOG_BOOTSTRAP_TOO_LATE');
  return 'start_historical_seed';
}

export function historicalCatalogMigrations(files: string[]): string[] {
  if (files.some(file => !/^\d{14}_[a-zA-Z0-9_]+\.sql$/.test(file))) throw new Error('MIGRATION_FILENAME_INVALID');
  const selected = files.filter(file => file.slice(0, 14) <= historicalCatalogCutoff).sort();
  if (!selected.some(file => file.startsWith(`${historicalCatalogCutoff}_`))) throw new Error('HISTORICAL_CATALOG_CUTOFF_MISSING');
  return selected;
}
