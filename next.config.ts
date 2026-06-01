import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained .next/standalone folder for lean Docker images.
  output: "standalone",
  // Transpile the globe stack's untranspiled ESM for consistent bundling. (Note:
  // the production-build hang we hit was caused by satellite.js v7's WASM build
  // importing `node:worker_threads`; we pin satellite.js v5, the pure-JS SGP4
  // build, which bundles cleanly for the browser.)
  transpilePackages: ["react-globe.gl", "three-globe"],
};

export default nextConfig;
