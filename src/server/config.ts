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

function scannerEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'tcp:' || !endpoint.hostname || !endpoint.port || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || (endpoint.pathname && endpoint.pathname !== '/')) throw new Error('Invalid configuration: FILE_SCAN_URL');
  return endpoint.toString();
}

function privateEncryptionKeys(raw: Env) {
  const key = raw.SECRET_ENCRYPTION_KEY?.trim() || null;
  const keyId = raw.SECRET_ENCRYPTION_KEY_ID?.trim() || 'v1';
  let previous: Record<string, string> = {};
  try {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(keyId) || (key && !/^[a-f\d]{64}$/i.test(key))) throw new Error();
    if (raw.SECRET_ENCRYPTION_PREVIOUS_KEYS) {
      const parsed: unknown = JSON.parse(raw.SECRET_ENCRYPTION_PREVIOUS_KEYS);
      if (!key || typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length > 8 || Object.hasOwn(parsed, keyId)) throw new Error();
      if (Object.entries(parsed).some(([id, value]) => !/^[A-Za-z0-9_-]{1,40}$/.test(id) || typeof value !== 'string' || !/^[a-f\d]{64}$/i.test(value))) throw new Error();
      previous = parsed as Record<string, string>;
    }
  } catch { throw new Error('Invalid private encryption configuration'); }
  return { key, keyId, previous };
}

function resendConfig(raw: Env, environment: Environment) {
  const from = raw.EMAIL_FROM!.trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(from) ||
      (environment === 'production' && /[@.]resend\.dev$/i.test(from))) {
    throw new Error('Invalid configuration: EMAIL_FROM');
  }
  const webhookSecret = raw.RESEND_WEBHOOK_SECRET!.trim();
  const encoded = webhookSecret.slice('whsec_'.length);
  if (!webhookSecret.startsWith('whsec_') || webhookSecret.length > 256 ||
      Buffer.byteLength(encoded, 'base64') < 16 || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
    throw new Error('Invalid configuration: RESEND_WEBHOOK_SECRET');
  }
  return { from, api_key: raw.RESEND_API_KEY!.trim(), webhook_secret: webhookSecret };
}

function gmailConfig(raw: Env) {
  const user = raw.GMAIL_SMTP_USER!.trim().toLowerCase();
  const app_password = raw.GMAIL_APP_PASSWORD!.replace(/\s/g, '');
  if (!/^[a-z0-9][a-z0-9.]*@gmail\.com$/.test(user)) throw new Error('Invalid configuration: GMAIL_SMTP_USER');
  if (!/^[a-z]{16}$/.test(app_password)) throw new Error('Invalid configuration: GMAIL_APP_PASSWORD');
  return { user, app_password };
}

/** Server-owned configuration. Never pass this object to a client component or log it. */
export function parseServerConfig(raw: Env) {
  if (raw.NODE_ENV === "production" && !raw.APP_ENV) throw new Error("APP_ENV must be explicit at production startup");
  const environment = choice<Environment>(raw.APP_ENV, ["development", "test", "staging", "production"], "development", "APP_ENV");
  const publicKeys = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  // Vercel injects this even when automatic system-variable exposure is disabled.
  // It is platform metadata, discarded here and never added to our public DTO.
  const platformKeys = new Set(['NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG']);
  if (Object.keys(raw).some(key => key.startsWith("NEXT_PUBLIC_") && !publicKeys.has(key) && !platformKeys.has(key))) {
    throw new Error("Unexpected public environment configuration");
  }
  const isolated = environment === "development" || environment === "test";
  const providers = {
    email: choice(raw.EMAIL_ADAPTER, ["fake", "ses", "resend", "gmail"], "fake", "EMAIL_ADAPTER"),
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
  if (providers.email === "ses") required.push("AWS_REGION", "EMAIL_FROM", "EMAIL_SNS_TOPIC_ARN", "EMAIL_CONFIGURATION_SET");
  if (providers.email === "resend") required.push("EMAIL_FROM", "RESEND_API_KEY", "RESEND_WEBHOOK_SECRET");
  if (providers.email === "gmail") required.push("GMAIL_SMTP_USER", "GMAIL_APP_PASSWORD");
  if (providers.calendar === "google") required.push("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI", "GOOGLE_CALENDAR_ID", "SECRET_ENCRYPTION_KEY");
  if (providers.whatsapp === "cloud") required.push("WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN");
  if (providers.file_scan === "clamav") required.push("FILE_SCAN_URL");
  const missing = required.filter(key => !raw[key]?.trim());
  if (missing.length) throw new Error(`Missing configuration keys: ${missing.join(", ")}`);
  const encryption = privateEncryptionKeys(raw);
  const appBaseUrl = absoluteUrl(raw.APP_BASE_URL || "http://localhost:3000", "APP_BASE_URL", !isolated);
  const google = providers.calendar === 'google' ? {
    client_id: raw.GOOGLE_OAUTH_CLIENT_ID!.trim(), client_secret: raw.GOOGLE_OAUTH_CLIENT_SECRET!.trim(),
    redirect_uri: absoluteUrl(raw.GOOGLE_OAUTH_REDIRECT_URI!.trim(), 'GOOGLE_OAUTH_REDIRECT_URI', !isolated), calendar_id: raw.GOOGLE_CALENDAR_ID!.trim(),
  } : null;
  const email = providers.email === 'ses' ? { region: raw.AWS_REGION!.trim(), from: raw.EMAIL_FROM!.trim(), topic_arn: raw.EMAIL_SNS_TOPIC_ARN!.trim(), configuration_set: raw.EMAIL_CONFIGURATION_SET!.trim() } : null;
  if (email && (!/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(email.region) || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email.from) || !new RegExp(`^arn:aws:sns:${email.region}:\\d{12}:[A-Za-z0-9_-]{1,256}$`).test(email.topic_arn) || !/^[A-Za-z0-9_-]{1,64}$/.test(email.configuration_set))) throw new Error('Invalid email configuration');
  if (google && (new URL(google.redirect_uri).origin !== new URL(appBaseUrl).origin || new URL(google.redirect_uri).pathname !== '/api/calendar/google/callback' || new URL(google.redirect_uri).search || new URL(google.redirect_uri).hash)) throw new Error('Invalid configuration: GOOGLE_OAUTH_REDIRECT_URI');
  return {
    environment, isolated, providers,
    app_base_url: appBaseUrl,
    supabase_url: supabaseUrl ? absoluteUrl(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL", !isolated) : null,
    supabase_publishable_key: publishableKey,
    worker_database_url: raw.WORKER_DATABASE_URL || null,
    supabase_secret_key: raw.SUPABASE_SECRET_KEY || null,
    secret_encryption_key: encryption.key,
    secret_encryption_key_id: encryption.keyId,
    secret_encryption_previous_keys: encryption.previous,
    google, email,
    resend: providers.email === 'resend' ? resendConfig(raw, environment) : null,
    gmail: providers.email === 'gmail' ? gmailConfig(raw) : null,
    file_scan_url: providers.file_scan === 'clamav' ? scannerEndpoint(raw.FILE_SCAN_URL!.trim()) : null,
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
