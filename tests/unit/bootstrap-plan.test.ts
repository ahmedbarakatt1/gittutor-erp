import { expect, test } from 'vitest';
import { chooseLocalBootstrapPlan, historicalCatalogMigrations } from '../../tools/bootstrap-plan';

const state = {
  environment: 'test', fixture_marker: 'git-tutor-supabase-local-v1',
  applied_versions: ['20261111103635'], auth_users: 0, has_domain_data: false, claim: null,
};
const claim = { source_version: 'local-historical-catalog-v1', cutoff: '20261111123430', stage: 'claimed' };

test('only an empty disposable database can begin the historical catalog seed stage', () => {
  expect(chooseLocalBootstrapPlan(state)).toBe('start_historical_seed');
  expect(chooseLocalBootstrapPlan({ ...state, auth_users: 1 })).toBe('append');
  expect(chooseLocalBootstrapPlan({ ...state, has_domain_data: true })).toBe('append');
  for (const invalid of [{ environment: 'production' }, { fixture_marker: 'different-project' }, { auth_users: -1 }, { auth_users: NaN }]) {
    expect(() => chooseLocalBootstrapPlan({ ...state, ...invalid })).toThrow();
  }
});

test('interrupted historical bootstrap resumes only its saved valid stage and never downgrades migrations', () => {
  expect(chooseLocalBootstrapPlan({ ...state, auth_users: 12, has_domain_data: true, claim })).toBe('resume_historical_seed');
  expect(chooseLocalBootstrapPlan({ ...state, claim: { ...claim, stage: 'catalog_seeded' } })).toBe('append');
  expect(chooseLocalBootstrapPlan({ ...state, claim: { ...claim, stage: 'complete' }, applied_versions: ['20261111141231'] })).toBe('append');
  expect(() => chooseLocalBootstrapPlan({ ...state, claim: { ...claim, cutoff: '99999999999999' } })).toThrow('LOCAL_BOOTSTRAP_STAGE_INVALID');
  expect(() => chooseLocalBootstrapPlan({ ...state, claim, applied_versions: ['20261111141231'] })).toThrow('LOCAL_BOOTSTRAP_STAGE_CONFLICT');
  expect(() => chooseLocalBootstrapPlan({ ...state, applied_versions: ['20261111141231'] })).toThrow('HISTORICAL_CATALOG_BOOTSTRAP_TOO_LATE');
  expect(chooseLocalBootstrapPlan({ ...state, has_domain_data: true, applied_versions: ['20261111141231'] })).toBe('append');
});

test('historical migration selection is bounded to the exact catalog cutoff', () => {
  expect(historicalCatalogMigrations(['20261111141231_package_contract_v2.sql', '20261111103635_foundation_outbox.sql', '20261111123430_catalog_policy_integer_validation.sql']))
    .toEqual(['20261111103635_foundation_outbox.sql', '20261111123430_catalog_policy_integer_validation.sql']);
  expect(() => historicalCatalogMigrations(['20261111103635_foundation_outbox.sql'])).toThrow('HISTORICAL_CATALOG_CUTOFF_MISSING');
  expect(() => historicalCatalogMigrations(['../20261111123430_unsafe.sql'])).toThrow('MIGRATION_FILENAME_INVALID');
});
