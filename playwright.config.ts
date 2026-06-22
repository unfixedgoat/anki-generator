import { defineConfig, devices } from "@playwright/test";

// Browser-level e2e for the DropZone client orchestration. Every backend route
// (whoami, me, deck/start, generate/chunk, finalize) is mocked per-test via
// page.route, so these run with zero Gemini, zero quota, and zero flake — they
// exercise ONLY the client merge/ordering/progress/modal/download logic. The
// live backend routes are covered separately by `npm run verify:chunk-pipeline`.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
