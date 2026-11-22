import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requestSupabase } from "@/server/supabase";
import { authRedirectBase, isAuthTokenHash } from "@/server/http";

const styles = `
  *{box-sizing:border-box} body{margin:0;background:#f8f6ef;color:#252526;font:1rem/1.55 Arial,sans-serif}
  main{max-width:31rem;margin:clamp(1rem,8vh,5rem) auto;padding:clamp(1.25rem,5vw,2rem);background:white;border:1px solid #dcd7cd;border-top:4px solid #ae292a;border-radius:8px}
  header{font-size:1.4rem;font-weight:bold} header span{color:#ae292a} h1{font-size:1.75rem;line-height:1.2}
  button{padding:.8rem 1.2rem;background:#ae292a;color:white;border:0;border-radius:6px;font:inherit;font-weight:bold;cursor:pointer}
  button:focus-visible{outline:3px solid #252526;outline-offset:3px} [lang=ar]{line-height:1.7}
`;
const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${createHash("sha256").update(styles).digest("base64")}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

function emailAction(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const hash = params.get("token_hash");
  const type = params.get("type");
  if (!hash || !isAuthTokenHash(hash) || (type !== "email" && type !== "invite" && type !== "recovery")) return null;
  const invitation = params.get("staff_invitation_id");
  return { hash, type, invitation: type === "invite" && invitation && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(invitation) ? invitation : null } as const;
}

// A form with no action posts to this same first-party URL. Its document contains
// no token, invitation reference, external resources, or active scripts.
function confirmationPage(type: "invite" | "email" | "recovery") {
  const copy = {
    email: ["Confirm your email address", "Confirm this email to finish creating your account.", "أكّد بريدك الإلكتروني لإكمال إنشاء حسابك.", "Confirm email", "تأكيد البريد"],
    invite: ["Open your invitation", "Continue to set a password and review your invitation.", "تابع لتعيين كلمة مرور ومراجعة دعوتك.", "Continue", "متابعة"],
    recovery: ["Reset your password", "Continue to choose a new password for your account.", "تابع لاختيار كلمة مرور جديدة لحسابك.", "Continue", "متابعة"],
  }[type];
  return new NextResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${copy[0]} | Git Tutor</title><style>${styles}</style></head><body><main>
    <header>Git <span>Tutor</span></header><h1>${copy[0]}</h1><p>${copy[1]}</p><p lang="ar" dir="rtl">${copy[2]}</p>
    <form method="post"><button type="submit" name="confirm" value="yes">${copy[3]} · <span lang="ar" dir="rtl">${copy[4]}</span></button></form>
    </main></body></html>`, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
}

function redirect(path: string, base: string) {
  return NextResponse.redirect(new URL(path, base), { status: 303, headers });
}

async function receivedConfirmation(request: NextRequest) {
  const expected = Buffer.from("confirm=yes");
  const size = request.headers.get("content-length");
  if ((size !== null && Number(size) !== expected.length) ||
      request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return false;
  const reader = request.body?.getReader();
  if (!reader) return false;
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return offset === expected.length;
    const end = offset + value.length;
    if (end > expected.length || !expected.subarray(offset, end).equals(value)) {
      await reader.cancel();
      return false;
    }
    offset = end;
  }
}

export function HEAD() {
  return new NextResponse(null, { headers });
}

export async function GET(request: NextRequest) {
  const action = emailAction(request);
  if (action) return confirmationPage(action.type);
  const context = requestSupabase(request);
  const base = authRedirectBase(request.url, context.config.app_base_url, context.config.isolated, request.headers.get("host"));
  const code = request.nextUrl.searchParams.get("code");
  if (code && code.length <= 4096) {
    const { data, error } = await context.client.auth.exchangeCodeForSession(code);
    if (!error) return context.finish(redirect("redirectType" in data && data.redirectType === "recovery" ? "/auth/set-password" : "/learn", base));
  }
  return context.finish(redirect("/login?reason=verification", base));
}

export async function POST(request: NextRequest) {
  const context = requestSupabase(request);
  const base = authRedirectBase(request.url, context.config.app_base_url, context.config.isolated, request.headers.get("host"));
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  // A no-referrer HTML form can produce a null Origin. Browsers still attest
  // the originating site in Fetch Metadata, which page scripts cannot forge.
  if ((fetchSite && fetchSite !== "same-origin") || (origin !== base && !(origin === "null" && fetchSite === "same-origin"))) {
    return new NextResponse(null, { status: 403, headers });
  }
  const action = emailAction(request);
  if (action && await receivedConfirmation(request)) {
    const { error } = await context.client.auth.verifyOtp({ token_hash: action.hash, type: action.type });
    if (!error) {
      const path = action.type === "email" ? "/learn" : "/auth/set-password";
      return context.finish(redirect(action.invitation ? `${path}?staff_invitation_id=${action.invitation}` : path, base));
    }
  }
  return context.finish(redirect("/login?reason=verification", base));
}
