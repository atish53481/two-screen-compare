import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A second dev server (the UI test suite) needs its own build dir: Next refuses two servers on one .next
  ...(process.env.QA_VISION_DIST_DIR ? { distDir: process.env.QA_VISION_DIST_DIR } : {}),
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
