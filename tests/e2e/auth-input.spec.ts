import { expect, test } from "@playwright/test";

test("auth transport rejects privilege injection and foreign origins without creating an account", async ({ request, baseURL }) => {
  const body = { email: "transport-only@example.test", password: "synthetic-test-password", role: "admin" };
  const forged = await request.post("/api/auth/signup", { data: body, headers: { Origin: baseURL! } });
  expect(forged.status()).toBe(400);
  expect((await forged.json()).code).toBe("VALIDATION_ERROR");
  expect(forged.headers()["cache-control"]).toContain("no-store");
  const crossSite = await request.post("/api/auth/login", { data: { email: body.email, password: body.password }, headers: { Origin: "https://untrusted.example" } });
  expect(crossSite.status()).toBe(403);
  expect((await crossSite.json()).code).toBe("FORBIDDEN");
});

test("logged-out API and oversized auth requests fail safely", async ({ request, baseURL }) => {
  const anonymous = await request.get("/api/v1/me");
  expect(anonymous.status()).toBe(401);
  expect((await anonymous.json()).code).toBe("AUTH_REQUIRED");
  const large = await request.post("/api/auth/login", { data: { email: "a@example.test", password: "x".repeat(70000) }, headers: { Origin: baseURL! } });
  expect(large.status()).toBe(400);
  const invalidFilter = await request.get("/api/v1/me?actor=admin");
  expect(invalidFilter.status()).toBe(400);
});
