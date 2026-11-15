import { describe, expect, it } from 'vitest';
import { assertHostedOperationalTarget, type HostedOperationalTarget } from '../../tools/hosted-operational-target';

const hash = 'a'.repeat(64);
const target = (): HostedOperationalTarget => ({
  marker: 'git-tutor-operational-preview-v1', project_ref: 'tjrbvejvnquhmqdwsacy',
  organization_id: 'jsnlueglhoymfefjeloc', source_sha256: hash,
  url: 'https://tjrbvejvnquhmqdwsacy.supabase.co', base_url: 'https://gittutor-erp-rho.vercel.app',
  database_url: 'postgresql://postgres.tjrbvejvnquhmqdwsacy:private@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=contracts%2Fruntime%2Fsupabase-root-2021.crt',
  worker_database_url: 'postgresql://git_tutor_worker.tjrbvejvnquhmqdwsacy:private@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=contracts%2Fruntime%2Fsupabase-root-2021.crt',
});

describe('authorized hosted workbook preview boundary', () => {
  it('accepts only the identified isolated development target and pinned source', () => {
    expect(() => assertHostedOperationalTarget(target(), hash, 'development')).not.toThrow();
    for (const environment of ['production', 'staging', 'test', undefined]) {
      expect(() => assertHostedOperationalTarget(target(), hash, environment)).toThrow();
    }
    expect(() => assertHostedOperationalTarget(target(), 'b'.repeat(64), 'development')).toThrow();
  });
  it('rejects another project, owner organization, public origin, marker and credential-bearing API URL', () => {
    for (const update of [
      {project_ref:'otherproject'}, {organization_id:'anotherorganization'}, {marker:'git-tutor-supabase-local-v1'},
      {url:'https://other.supabase.co'}, {url:'https://secret@tjrbvejvnquhmqdwsacy.supabase.co'},
      {base_url:'https://other.vercel.app'}, {source_sha256:'not-a-checksum'},
    ]) expect(() => assertHostedOperationalTarget({...target(),...update},hash,'development')).toThrow();
  });
  it('rejects insecure TLS, untrusted hosts, privileged worker credentials, transaction pooling and URL overrides', () => {
    for (const key of ['database_url','worker_database_url'] as const) {
      const original = target()[key];
      for (const connection of [
        original.replace('verify-full','require'), original.replace(':5432/',':6543/'),
        original.replace('aws-1-eu-central-1.pooler.supabase.com','attacker.example'),
        original.replace('contracts%2Fruntime%2Fsupabase-root-2021.crt','untrusted.crt'),
        original+'&sslmode=disable', original+'&options=-c%20role%3Dpostgres',
      ]) expect(() => assertHostedOperationalTarget({...target(),[key]:connection},hash,'development')).toThrow();
    }
    expect(() => assertHostedOperationalTarget({...target(),worker_database_url:target().database_url},hash,'development')).toThrow();
  });
});
