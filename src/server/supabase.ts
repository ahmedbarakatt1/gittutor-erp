import "server-only";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { parseServerConfig } from "./config";

export class AuthUnavailableError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE";
  constructor() { super("Sign-in is temporarily unavailable. Try again shortly."); }
}

export function authConfiguration() {
  const config = parseServerConfig(process.env);
  if (!config.supabase_url || !config.supabase_publishable_key) throw new AuthUnavailableError();
  return { ...config, supabase_url: config.supabase_url, supabase_publishable_key: config.supabase_publishable_key };
}

export async function serverSupabase() {
  const config = authConfiguration();
  const store = await cookies();
  return createServerClient(config.supabase_url, config.supabase_publishable_key, {
    db: { schema: "api" },
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: new URL(config.app_base_url).protocol === 'https:', path: "/" },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        // Server Components cannot write cookies; proxy refreshes them before rendering.
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch { /* Cookie writes are owned by proxy and route handlers. */ }
      },
    },
  });
}

/** Route handlers retain every refresh cookie and cache header on their actual response. */
export function requestSupabase(request: NextRequest) {
  const config = authConfiguration();
  const pending = new Map<string, { name: string; value: string; options: CookieOptions }>();
  const responseHeaders = new Headers();
  const client = createServerClient(config.supabase_url, config.supabase_publishable_key, {
    db: { schema: "api" },
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: new URL(config.app_base_url).protocol === 'https:', path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        for (const cookie of values) { request.cookies.set(cookie.name, cookie.value); pending.set(cookie.name, cookie); }
        Object.entries(headers).forEach(([key, value]) => responseHeaders.set(key, value));
      },
    },
  });
  return {
    client, config,
    finish(response: NextResponse) {
      for (const { name, value, options } of pending.values()) response.cookies.set(name, value, options);
      responseHeaders.forEach((value, key) => response.headers.set(key, value));
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    },
  };
}
