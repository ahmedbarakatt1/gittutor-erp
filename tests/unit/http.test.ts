import { expect, it } from "vitest";
import { allowedOrigin, authRedirectBase, isAuthTokenHash, safeError, loginInput, signupInput, landingForRoles } from "../../src/server/http";

it("cookie mutations accept only configured or isolated loopback origins", () => {
  expect(allowedOrigin("https://evil.example", "http://localhost:3000", true)).toBe(false);
  expect(allowedOrigin(null, "http://localhost:3000", true)).toBe(false);
  expect(allowedOrigin("http://127.0.0.1:3000", "http://localhost:3000", true)).toBe(true);
  expect(allowedOrigin("http://127.0.0.1:3000", "https://tutor.example", false)).toBe(false);
});
it("signup and login reject caller supplied roles and identities", () => {
  expect(loginInput.safeParse({ email: "learner@example.test", password: "synthetic-password", role: "admin" }).success).toBe(false);
  expect(signupInput.safeParse({ email: "learner@example.test", password: "synthetic-password", account_id: "actor" }).success).toBe(false);
  expect(signupInput.safeParse({ email: "learner@example.test", password: "synthetic-password" }).success).toBe(true);
});
it("unclassified errors never expose secrets or internal database messages", () => {
  expect(JSON.stringify(safeError(new Error("postgres private token: secret")))).not.toMatch(/postgres|token|secret/);
  expect(safeError({ message: "VERSION_CONFLICT" }).status).toBe(409);
});
it("portal destinations depend on current roles and remain an internal allowlist", () => {
  expect(landingForRoles(["student"])).toBe("/learn");
  expect(landingForRoles(["guardian"])).toBe("/learn");
  expect(landingForRoles(["tutor"])).toBe("/tutor");
  expect(landingForRoles(["customer_service"])).toBe("/service");
  expect(landingForRoles(["admin"])).toBe("/admin");
  expect(landingForRoles(["https://evil.example"])).toBe("/learn");
});
it("Auth redirects preserve approved local cookie hosts without trusting arbitrary hosts", () => {
  expect(authRedirectBase("http://127.0.0.1:3000/auth/callback", "http://localhost:3000", true)).toBe("http://127.0.0.1:3000");
  expect(authRedirectBase("http://evil.example/auth/callback", "http://localhost:3000", true)).toBe("http://localhost:3000");
  expect(authRedirectBase("http://127.0.0.1:3001/auth/callback", "http://localhost:3000", true)).toBe("http://localhost:3000");
  expect(authRedirectBase("http://127.0.0.1:3000/auth/callback", "https://tutor.example", false)).toBe("https://tutor.example");
});
it("Auth redirects use the approved browser Host when Next normalizes its internal request URL", () => {
  expect(authRedirectBase("http://localhost:3000/auth/callback", "http://localhost:3000", true, "127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  expect(authRedirectBase("http://localhost:3000/auth/callback", "https://tutor.example", false, "attacker.example")).toBe("https://tutor.example");
});
it("Auth email hashes accept real PKCE confirmation shape and remain bounded", () => {
  expect(isAuthTokenHash(`pkce_${'a'.repeat(56)}`)).toBe(true);
  expect(isAuthTokenHash('b'.repeat(56))).toBe(true);
  expect(isAuthTokenHash(`pkce_${'a'.repeat(129)}`)).toBe(false);
  expect(isAuthTokenHash('pkce_<script>')).toBe(false);
});
