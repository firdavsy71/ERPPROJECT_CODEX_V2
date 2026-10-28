import { config } from "dotenv";
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
config({ path: ".env.local", quiet: true });
if (process.env.DATABASE_URL) throw new Error("Use an isolated local database for visual capture.");
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ?? "/usr/bin/chromium" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const directory = `.local/redesign-${process.env.CAPTURE_STAGE ?? "before"}`;
await mkdir(directory, { recursive: true });
try {
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("Email address").fill(process.env.ADMIN_EMAIL!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await page.waitForURL("**/dashboard");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1050 });
    await page.screenshot({ path: `${directory}/dashboard-${width}.png`, fullPage: true });
  }
  console.log(`Captured dashboard at1440 and390 in ${directory}`);
} finally { await browser.close(); }
