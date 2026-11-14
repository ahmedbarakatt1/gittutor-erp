import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Containers build relocatable Linux output; keep the Windows preview launch unchanged.
  output: process.env.GIT_TUTOR_STANDALONE === '1' ? 'standalone' : undefined,
  // Auth callback queries contain single-use credentials. Keep them out of dev request logs.
  logging: { incomingRequests: { ignore: [/\/auth\/callback(?:[/?]|$)/] } },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }, { source: "/auth/callback", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};
export default config;
