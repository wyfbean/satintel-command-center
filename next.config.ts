import type { NextConfig } from "next";

// The Python CrewAI backend.  Override with AGENT_BACKEND_URL in .env.local.
const AGENT_BACKEND =
  (process.env.AGENT_BACKEND_URL ?? "http://127.0.0.1:8000").replace(/\/agent\/?$/, "");

// CORS headers applied to every /api/* response (including preflight OPTIONS).
// Adjust CORS_ORIGIN in .env.local when deploying to a specific domain.
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";

const corsHeaders = [
  { key: "Access-Control-Allow-Origin",      value: CORS_ORIGIN },
  { key: "Access-Control-Allow-Methods",     value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
  { key: "Access-Control-Allow-Headers",     value: "Content-Type,Authorization,X-Requested-With" },
  { key: "Access-Control-Allow-Credentials", value: "true" },
  { key: "Access-Control-Max-Age",           value: "86400" },
];

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone folder for lean Docker images.
  output: "standalone",

  // Allow dev-server HMR/asset requests from non-localhost hosts (e.g. the
  // WSL2 / Docker bridge interface 172.18.0.1, or a LAN IP). Next 16 blocks
  // cross-origin access to /_next/* dev resources by default.
  allowedDevOrigins: ["172.18.0.1"],

  // Transpile the globe stack's untranspiled ESM for consistent bundling. (Note:
  // the production-build hang we hit was caused by satellite.js v7's WASM build
  // importing `node:worker_threads`; we pin satellite.js v5, the pure-JS SGP4
  // build, which bundles cleanly for the browser.)
  transpilePackages: ["react-globe.gl", "three-globe"],

  // ── CORS ──────────────────────────────────────────────────────────────
  // Attach CORS headers to all Next.js API routes so external callers
  // (e.g. the Python agent backend, other micro-frontends, or local tools)
  // can reach them without browser cross-origin blocks.
  async headers() {
    return [
      {
        // Match every API route (Next.js routes + the copilotkit runtime).
        source: "/api/:path*",
        headers: corsHeaders,
      },
    ];
  },

  // ── Rewrites ──────────────────────────────────────────────────────────
  // Proxy /api/agent/* to the Python backend so the browser makes
  // same-origin requests (avoids a second CORS negotiation with FastAPI).
  async rewrites() {
    return [
      {
        source: "/api/agent/:path*",
        destination: `${AGENT_BACKEND}/:path*`,
      },
    ];
  },
};

export default nextConfig;
