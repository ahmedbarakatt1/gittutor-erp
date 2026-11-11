import { describe, expect, it } from "vitest";
import { parseServerConfig, publicConfig } from "../../src/server/config";

describe("configuration boundary", () => {
  it("allows isolated fake development without credentials", () => {
    const config = parseServerConfig({ APP_ENV: "development" });
    expect(config.providers).toEqual({ email: "fake", calendar: "fake", whatsapp: "fake", file_scan: "fake", payments: "manual" });
  });
  it("public projection contains only browser identity configuration", () => {
    const config = parseServerConfig({ APP_ENV: "test", SUPABASE_SECRET_KEY: "secret-do-not-serialize", WORKER_DATABASE_URL: "postgres://private", SECRET_ENCRYPTION_KEY: "another-secret" });
    expect(publicConfig(config)).toEqual({ supabase_url: null, supabase_publishable_key: null });
    expect(JSON.stringify(publicConfig(config))).not.toContain("secret");
  });
  it("rejects unknown modes and public secret-shaped environment keys", () => {
    expect(() => parseServerConfig({ EMAIL_ADAPTER: "typo" })).toThrow();
    expect(() => parseServerConfig({ NEXT_PUBLIC_SUPABASE_SECRET_KEY: "x" })).toThrow(/public/i);
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
});
