import { defineConfig } from "@playwright/test";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
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
    command: "npm start",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
