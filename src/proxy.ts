import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { parseServerConfig } from "./server/config";

export async function proxy(request: NextRequest) {
  const settings = parseServerConfig(process.env);
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!settings.supabase_url || !settings.supabase_publishable_key) return response;
  const client = createServerClient(settings.supabase_url, settings.supabase_publishable_key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: !settings.isolated, path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        const previous = response.cookies.getAll();
        response = NextResponse.next({ request });
        previous.forEach(cookie => response.cookies.set(cookie));
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        response.headers.set("Cache-Control", "private, no-store");
      },
    },
  });
  await client.auth.getClaims();
  return response;
}

export const config = { matcher: ["/login", "/signup", "/offers/:id", "/tutors/:id", "/auth/:path*", "/learn/:path*", "/tutor/:path*", "/service/:path*", "/admin/:path*", "/api/:path*"] };
