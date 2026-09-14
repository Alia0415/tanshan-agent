import type { NextConfig } from "next";

const config: NextConfig = {
  devIndicators: false,
  // The OAuth callback is registered for http://127.0.0.1, so dev is served
  // there; Next only trusts localhost for /_next dev resources by default.
  // WENSHAN_DEV_ORIGINS adds LAN hosts (comma separated) for phone testing.
  allowedDevOrigins: [
    "127.0.0.1",
    ...(process.env.WENSHAN_DEV_ORIGINS?.split(",").map((host) => host.trim()).filter(Boolean) ?? []),
  ],
  output: process.env.WENSHAN_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  // The hackathon callback is registered as the bare origin (no path), so
  // Zhihu returns the authorization code on "/"; hand it to the OAuth route.
  // Must run beforeFiles, otherwise the home page wins the "/" match.
  async rewrites() {
    return {
      beforeFiles: ["authorization_code", "code"].map((key) => ({
        source: "/",
        has: [{ type: "query" as const, key }],
        destination: "/api/oauth/callback",
      })),
      afterFiles: [
        // Static easter-egg page built with Vite and shipped in public/lumora.
        { source: "/lumora", destination: "/lumora/index.html" },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
