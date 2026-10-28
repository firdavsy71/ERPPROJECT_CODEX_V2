import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const config: NextConfig = {
  outputFileTracingIncludes: {"/api/documents/**": ["./assets/fonts/**/*"]},
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "@neondatabase/serverless",
    "ws",
    "https-proxy-agent",
    "pdfkit",
    "sharp",
  ],
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
