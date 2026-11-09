import path from "node:path";

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  turbopack: {
    // The workspace root: dependencies are symlinked from its node_modules.
    root: path.resolve(import.meta.dirname, ".."),
  },
  basePath: "/better-auth",
  reactStrictMode: true,
  redirects: async () => {
    return [
      {
        source: "/local-install",
        destination: "/features/local-install",
        permanent: true,
      },
      {
        source: "/authorization",
        destination: "/basic-usage/authorization",
        permanent: true,
      },
      {
        source: "/triggers",
        destination: "/features/triggers",
        permanent: true,
      },
    ];
  },
};

export default withMDX(config);
