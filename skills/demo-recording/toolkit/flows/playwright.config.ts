import { defineConfig, devices } from "@playwright/test";

/* E2E flows. Each business flow in docs/flows/<feature>.md has a co-located
   <feature>.spec.ts that executes (and asserts) that flow. One command runs them
   all: `pnpm test:flows`. Runs against a deployed instance (DEMO_URL) by default.
   Copy this file to your project's docs/flows/ root (or repo root with
   testDir: "./docs/flows"). */
export default defineConfig({
  testDir: "./docs/flows",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1, // shared live DB -> avoid cross-test races
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "docs/flows/.report", open: "never" }]],
  use: {
    baseURL: process.env.DEMO_URL || "http://localhost:3000",
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
