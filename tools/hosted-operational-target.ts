import assert from 'node:assert/strict';

export type HostedOperationalTarget = {
  marker: string; project_ref?: string; organization_id?: string; source_sha256?: string;
  url: string; base_url?: string; database_url: string; worker_database_url: string;
};

export function assertHostedOperationalTarget(config: HostedOperationalTarget, sourceHash: string, environment: string | undefined): void {
  // This is the owner-authorized pilot, never a generic remote seeder or production cutover.
  const project = 'tjrbvejvnquhmqdwsacy';
  assert.equal(environment, 'development', 'HOSTED_PREVIEW_ENVIRONMENT_REQUIRED');
  assert.equal(config.marker, 'git-tutor-operational-preview-v1', 'HOSTED_PREVIEW_MARKER_REQUIRED');
  assert.equal(config.project_ref, project, 'HOSTED_PREVIEW_PROJECT_REQUIRED');
  assert.equal(config.organization_id, 'jsnlueglhoymfefjeloc', 'HOSTED_PREVIEW_ORGANIZATION_REQUIRED');
  assert.equal(config.url, `https://${project}.supabase.co`, 'HOSTED_PREVIEW_API_REQUIRED');
  assert.equal(config.base_url, 'https://gittutor-erp-rho.vercel.app', 'HOSTED_PREVIEW_ORIGIN_REQUIRED');
  assert.match(sourceHash, /^[a-f0-9]{64}$/, 'HOSTED_PREVIEW_SOURCE_REQUIRED');
  assert.equal(config.source_sha256, sourceHash, 'HOSTED_PREVIEW_SOURCE_CHANGED');
  for (const [connection, role] of [[config.database_url, 'postgres'], [config.worker_database_url, 'git_tutor_worker']]) {
    const address = new URL(connection);
    assert.equal(address.protocol, 'postgresql:', 'HOSTED_PREVIEW_DATABASE_PROTOCOL_REQUIRED');
    assert.equal(address.hostname, 'aws-1-eu-central-1.pooler.supabase.com', 'HOSTED_PREVIEW_DATABASE_HOST_REQUIRED');
    assert.equal(address.username, `${role}.${project}`, 'HOSTED_PREVIEW_DATABASE_ROLE_REQUIRED');
    assert(address.password && !address.hash, 'HOSTED_PREVIEW_DATABASE_CREDENTIAL_REQUIRED');
    assert.equal(address.port, '5432', 'HOSTED_PREVIEW_SESSION_POOLER_REQUIRED');
    assert.equal(address.pathname, '/postgres', 'HOSTED_PREVIEW_DATABASE_REQUIRED');
    assert.deepEqual([...address.searchParams.keys()].sort(), ['sslmode', 'sslrootcert'], 'HOSTED_PREVIEW_TLS_OPTIONS_REQUIRED');
    assert.equal(address.searchParams.get('sslmode'), 'verify-full', 'HOSTED_PREVIEW_VERIFIED_TLS_REQUIRED');
    assert.equal(address.searchParams.get('sslrootcert'), 'contracts/runtime/supabase-root-2021.crt', 'HOSTED_PREVIEW_CA_REQUIRED');
  }
}

