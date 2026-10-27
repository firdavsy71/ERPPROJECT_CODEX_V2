import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "@neondatabase/serverless",
    "ws",
    "https-proxy-agent",
  ],
};
export default config;
