import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node built-in; keep it out of the bundle.
  serverExternalPackages: [],
};

export default nextConfig;
