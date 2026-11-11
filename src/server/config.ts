type Environment = "development" | "test" | "staging" | "production";
type Env = Record<string, string | undefined>;

function choice<T extends string>(raw: string | undefined, choices: readonly T[], fallback: T, key: string): T {
  const value = raw?.trim() || fallback;
  if (!choices.includes(value as T)) throw new Error(`Invalid configuration: ${key}`);
  return value as T;
}

function absoluteUrl(value: string, key: string, requireHttps = false): string {
  const parsed = new URL(value);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || (requireHttps && parsed.protocol !== "https:")) {
    throw new Error(`Invalid configuration: ${key}`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function isBrowserKey(value: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  // Classification only; Supabase verifies JWT signatures. Never expose a privileged legacy key.
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload === "object" && payload !== null && "role" in payload && payload.role === "anon";
  } catch { return false; }
}

/** Server-owned configuration. Never pass this object to a client component or log it. */
export function parseServerConfig(raw: Env) {
  if (raw.NODE_ENV === "production" && !raw.APP_ENV) throw new Error("APP_ENV must be explicit at production startup");
  const environment = choice<Environment>(raw.APP_ENV, ["development", "test", "staging", "production"], "development", "APP_ENV");
  const publicKeys = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  if (Object.keys(raw).some(key => key.startsWith("NEXT_PUBLIC_") && !publicKeys.has(key))) {
    throw new Error("Unexpected public environment configuration");
  }
  const isolated = environment === "development" || environment === "test";
  const providers = {
    email: choice(raw.EMAIL_ADAPTER, ["fake", "ses"], "fake", "EMAIL_ADAPTER"),
    calendar: choice(raw.CALENDAR_ADAPTER, ["fake", "google"], "fake", "CALENDAR_ADAPTER"),
    whatsapp: choice(raw.WHATSAPP_ADAPTER, ["fake", "cloud"], "fake", "WHATSAPP_ADAPTER"),
    file_scan: choice(raw.FILE_SCAN_ADAPTER, ["fake", "clamav"], "fake", "FILE_SCAN_ADAPTER"),
    payments: choice(raw.PAYMENT_RECONCILIATION_ADAPTER, ["manual"], "manual", "PAYMENT_RECONCILIATION_ADAPTER"),
  };
  if (!isolated && Object.values(providers).includes("fake")) throw new Error("Fake providers require an isolated development/test environment");
  const supabaseUrl = raw.NEXT_PUBLIC_SUPABASE_URL?.trim() || null;
  const publishableKey = raw.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() || null;
  if (Boolean(supabaseUrl) !== Boolean(publishableKey)) throw new Error("Supabase public configuration is incomplete");
  if (publishableKey && !isBrowserKey(publishableKey)) throw new Error("Invalid public Supabase key classification");
  const required: string[] = [];
  if (!isolated) required.push("APP_BASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "WORKER_DATABASE_URL", "SUPABASE_SECRET_KEY", "SECRET_ENCRYPTION_KEY");
  if (providers.email === "ses") required.push("AWS_REGION", "EMAIL_FROM", "EMAIL_SNS_TOPIC_ARN");
  if (providers.calendar === "google") required.push("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "GOOGLE_CALENDAR_ID");
  if (providers.whatsapp === "cloud") required.push("WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN");
  if (providers.file_scan === "clamav") required.push("FILE_SCAN_URL");
  const missing = required.filter(key => !raw[key]?.trim());
  if (missing.length) throw new Error(`Missing configuration keys: ${missing.join(", ")}`);
  if (!isolated && !/^[a-f\d]{64}$/i.test(raw.SECRET_ENCRYPTION_KEY || "")) throw new Error("SECRET_ENCRYPTION_KEY must encode 32 bytes in hexadecimal");
  return {
    environment, isolated, providers,
    app_base_url: absoluteUrl(raw.APP_BASE_URL || "http://localhost:3000", "APP_BASE_URL", !isolated),
    supabase_url: supabaseUrl ? absoluteUrl(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL", !isolated) : null,
    supabase_publishable_key: publishableKey,
    worker_database_url: raw.WORKER_DATABASE_URL || null,
    supabase_secret_key: raw.SUPABASE_SECRET_KEY || null,
    secret_encryption_key: raw.SECRET_ENCRYPTION_KEY || null,
  };
}

export type ServerConfig = ReturnType<typeof parseServerConfig>;

/** This allowlist is the only browser-safe configuration projection. */
export function publicConfig(config: ServerConfig) {
  return { supabase_url: config.supabase_url, supabase_publishable_key: config.supabase_publishable_key };
}

export function integrationStates(config: ServerConfig) {
  return Object.entries(config.providers).map(([provider, mode]) => ({ provider, mode, state: mode === "fake" ? "simulated" : "verification_required" }));
}
