import { describe, expect, it } from "vitest";
import { parseServerConfig, publicConfig } from "../../src/server/config";

describe("configuration boundary", () => {
  it("allows isolated fake development without credentials", () => {
    const config = parseServerConfig({ APP_ENV: "development" });
    expect(config.providers).toEqual({ email: "fake", calendar: "fake", whatsapp: "fake", file_scan: "fake", payments: "manual" });
  });
  it("public projection contains only browser identity configuration", () => {
    const config = parseServerConfig({ APP_ENV: "test", SUPABASE_SECRET_KEY: "secret-do-not-serialize", WORKER_DATABASE_URL: "postgres://private", SECRET_ENCRYPTION_KEY: "a".repeat(64) });
    expect(publicConfig(config)).toEqual({ supabase_url: null, supabase_publishable_key: null });
    expect(JSON.stringify(publicConfig(config))).not.toContain("secret");
  });
  it("rejects unknown modes and public secret-shaped environment keys", () => {
    expect(() => parseServerConfig({ EMAIL_ADAPTER: "typo" })).toThrow();
    expect(() => parseServerConfig({ NEXT_PUBLIC_SUPABASE_SECRET_KEY: "x" })).toThrow(/public/i);
  });
  it('tolerates the exact Vercel-injected observability setting without forwarding it', () => {
    const config = parseServerConfig({APP_ENV:'test',NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG:'platform-client-configuration'});
    expect(publicConfig(config)).toEqual({supabase_url:null,supabase_publishable_key:null});
    expect(JSON.stringify(config)).not.toContain('platform-client-configuration');
    expect(() => parseServerConfig({APP_ENV:'test',NEXT_PUBLIC_VERCEL_OBSERVABILITY_SECRET:'private-sentinel'})).toThrow(/public/i);
  });
  it("rejects a half configured Supabase browser client", () => {
    expect(() => parseServerConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" })).toThrow();
  });
  it("rejects legacy service-role JWTs in the public projection", () => {
    const token = ["header", Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url"), "signature"].join(".");
    expect(() => parseServerConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token })).toThrow(/public/i);
  });
  it("accepts only a publishable key or legacy anonymous browser key", () => {
    const base = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };
    expect(publicConfig(parseServerConfig({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key" })).supabase_publishable_key).toBe("sb_publishable_test_key");
    const token = ["header", Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url"), "signature"].join(".");
    expect(publicConfig(parseServerConfig({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: token })).supabase_publishable_key).toBe(token);
    expect(() => parseServerConfig({ ...base, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "unclassified-secret" })).toThrow(/public/i);
  });
  it("rejects fake adapters in production independent of NODE_ENV", () => {
    expect(() => parseServerConfig({ APP_ENV: "production", NODE_ENV: "development" })).toThrow();
  });
  it("requires explicit deployment environment on production start", () => {
    expect(() => parseServerConfig({ NODE_ENV: "production" })).toThrow(/APP_ENV/);
  });
  it("validates complete live configuration without exposing secrets", () => {
    expect(() => parseServerConfig({ APP_ENV: "production", EMAIL_ADAPTER: "ses", CALENDAR_ADAPTER: "google", WHATSAPP_ADAPTER: "cloud", FILE_SCAN_ADAPTER: "clamav" })).toThrow();
  });
  it('requires complete server-only settings for Resend and leaves fake and SES settings independent', () => {
    const resend = {
      APP_ENV: 'test',
      EMAIL_ADAPTER: 'resend',
      EMAIL_FROM: 'lessons@example.test',
      RESEND_API_KEY: 're_synthetic_send_only_key',
      RESEND_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
    };
    for (const key of ['EMAIL_FROM', 'RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET']) {
      expect(() => parseServerConfig({ ...resend, [key]: ' ' })).toThrow(key);
    }
    const config = parseServerConfig(resend);
    expect(config.resend).toEqual({ from: resend.EMAIL_FROM, api_key: resend.RESEND_API_KEY, webhook_secret: resend.RESEND_WEBHOOK_SECRET });
    expect(config.email).toBeNull();
    expect(publicConfig(config)).toEqual({ supabase_url: null, supabase_publishable_key: null });
    expect(parseServerConfig({ ...resend, EMAIL_ADAPTER: 'fake' }).resend).toBeNull();
    expect(parseServerConfig({
      APP_ENV: 'test',
      EMAIL_ADAPTER: 'ses',
      AWS_REGION: 'eu-west-1',
      EMAIL_FROM: 'lessons@example.test',
      EMAIL_SNS_TOPIC_ARN: 'arn:aws:sns:eu-west-1:123456789012:notifications',
      EMAIL_CONFIGURATION_SET: 'notifications',
    }).email).toMatchObject({ region: 'eu-west-1', from: 'lessons@example.test' });
  });
  it('rejects a test sender in production and malformed private signing inputs', () => {
    const production = {
      APP_ENV: 'production',
      APP_BASE_URL: 'https://tutor.example.test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://database.example.test',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
      SUPABASE_SECRET_KEY: 'synthetic_secret',
      WORKER_DATABASE_URL: 'postgres://synthetic',
      SECRET_ENCRYPTION_KEY: 'a'.repeat(64),
      EMAIL_ADAPTER: 'resend',
      EMAIL_FROM: 'lessons@example.test',
      RESEND_API_KEY: 're_synthetic_send_only_key',
      RESEND_WEBHOOK_SECRET: `whsec_${Buffer.alloc(32, 1).toString('base64')}`,
      CALENDAR_ADAPTER: 'google',
      GOOGLE_OAUTH_CLIENT_ID: 'synthetic',
      GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic',
      GOOGLE_OAUTH_REDIRECT_URI: 'https://tutor.example.test/api/calendar/google/callback',
      GOOGLE_CALENDAR_ID: 'synthetic',
      WHATSAPP_ADAPTER: 'cloud',
      WHATSAPP_BUSINESS_ACCOUNT_ID: 'synthetic',
      WHATSAPP_PHONE_NUMBER_ID: 'synthetic',
      WHATSAPP_ACCESS_TOKEN: 'synthetic',
      WHATSAPP_APP_SECRET: 'synthetic',
      WHATSAPP_VERIFY_TOKEN: 'synthetic',
      FILE_SCAN_ADAPTER: 'clamav',
      FILE_SCAN_URL: 'tcp://scanner.example.test:3310',
    };
    expect(parseServerConfig(production).providers.email).toBe('resend');
    expect(() => parseServerConfig({ ...production, EMAIL_FROM: 'onboarding@RESEND.dev' })).toThrow(/EMAIL_FROM/);
    expect(() => parseServerConfig({ ...production, RESEND_WEBHOOK_SECRET: 'whsec_invalid-private-material' }))
      .toThrow('Invalid configuration: RESEND_WEBHOOK_SECRET');
  });
  it('keeps versioned encryption keys private and validates provided development keys too', () => {
    const config = parseServerConfig({ APP_ENV: 'test', SECRET_ENCRYPTION_KEY: 'a'.repeat(64), SECRET_ENCRYPTION_KEY_ID: 'current', SECRET_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ prior: 'b'.repeat(64) }) });
    expect(config.secret_encryption_key_id).toBe('current');
    expect(config.secret_encryption_previous_keys).toEqual({ prior: 'b'.repeat(64) });
    expect(Object.keys(publicConfig(config))).toEqual(['supabase_url', 'supabase_publishable_key']);
    expect(() => parseServerConfig({ APP_ENV: 'test', SECRET_ENCRYPTION_KEY: 'invalid-private-key' })).toThrow('Invalid private encryption configuration');
  });
  it('rejects invalid rotation maps and duplicate active key identities without echoing secrets', () => {
    for (const previous of ['not-json', '[]', JSON.stringify({ v1: 'b'.repeat(64) }), JSON.stringify({ previous: 'private-invalid-material' })]) {
      expect(() => parseServerConfig({ APP_ENV: 'test', SECRET_ENCRYPTION_KEY: 'a'.repeat(64), SECRET_ENCRYPTION_PREVIOUS_KEYS: previous })).toThrow('Invalid private encryption configuration');
    }
    expect(() => parseServerConfig({ APP_ENV: 'test', SECRET_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ prior: 'b'.repeat(64) }) })).toThrow('Invalid private encryption configuration');
  });
});
