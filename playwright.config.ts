import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
if (process.env.DATABASE_URL)
  throw new Error(
    "Browser tests create business records. Use an isolated local database: set DATABASE_URL to an empty string and PGLITE_DATA_DIR to a separate test directory, migrate and seed it first.",
  );
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    actionTimeout: 15000,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  webServer: {
    env: { BLOB_READ_WRITE_TOKEN: "" },
    command: "npm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
