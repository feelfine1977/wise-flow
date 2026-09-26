import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }], ["junit", { outputFile: "reports/browser.xml" }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 800 },
    baseURL: "http://127.0.0.1:6008",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "node scripts/serve-storybook.mjs",
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: "http://127.0.0.1:6008/iframe.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
