import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OCR and rasterisation are native/server-only packages. Keep them out of the
  // client bundle and let Node load them at runtime.
  serverExternalPackages: [
    "tesseract.js",
    "@tesseract.js-data/eng",
    "@napi-rs/canvas",
    "unpdf",
  ],
};

export default nextConfig;
