import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/WASM server deps must stay external to the bundler
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
