import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents disabled: it conflicts with API route segment configs
  // and caused stale client bundles during development.
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
