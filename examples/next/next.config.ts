import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // The workspace root: dependencies are symlinked from its node_modules.
    root: path.join(__dirname, "../.."),
  },
  reactStrictMode: false,
};

export default nextConfig;
