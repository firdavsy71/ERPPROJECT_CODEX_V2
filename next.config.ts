import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
const config: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "@neondatabase/serverless",
    "ws",
    "https-proxy-agent",
  ],
};
export default createNextIntlPlugin("./src/i18n/request.ts")(config);
