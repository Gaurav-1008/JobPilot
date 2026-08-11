import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Load heavy Node-native/worker-based packages from node_modules at runtime
  // instead of bundling them. pdf-parse (pdfjs worker), playwright (Chromium),
  // and mammoth all break when bundled by Turbopack.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "playwright",
    "playwright-core",
    "mammoth",
  ],
};

export default nextConfig;
