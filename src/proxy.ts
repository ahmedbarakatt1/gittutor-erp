import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { parseServerConfig } from "./server/config";
import { sessionView } from "./server/session-view";

export async function proxy(request: NextRequest) {
  // The callback owns its session change. Preview reads must never refresh one.
  if (request.nextUrl.pathname === "/auth/callback") return NextResponse.next();
  const settings = parseServerConfig(process.env);
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  if (!settings.supabase_url || !settings.supabase_publishable_key) return response;
  const client = createServerClient(settings.supabase_url, settings.supabase_publishable_key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: new URL(settings.app_base_url).protocol === "https:", path: "/" },
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
  const { data, error } = await client.auth.getClaims();
  const view = sessionView(error ? null : data?.claims.session_id);
  const expected = request.headers.get('x-git-tutor-view') ??
    (request.nextUrl.pathname === '/api/drive/connect' ? request.nextUrl.searchParams.get('view') : null);
  if (expected !== null && expected !== view) {
    return NextResponse.json({ code: 'SESSION_CHANGED', message: 'The signed-in account has changed.', request_id: crypto.randomUUID() },
      { status: 409, headers: { 'Cache-Control': 'private, no-store', 'X-Git-Tutor-Session-Changed': '1' } });
  }
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    const incoming = new Headers(request.headers);
    incoming.set('x-git-tutor-rendered-view', view);
    const page = NextResponse.next({ request: { headers: incoming } });
    response.cookies.getAll().forEach(cookie => page.cookies.set(cookie));
    page.headers.set('Cache-Control', 'private, no-store');
    return page;
  }
  return response;
}

export const config = { matcher: ["/", "/subjects", "/support", "/apply-to-teach", "/login", "/signup", "/offers/:path*", "/tutors/:id", "/auth/:path*", "/learn/:path*", "/tutor/:path*", "/service/:path*", "/admin/:path*", "/api/:path*"] };
