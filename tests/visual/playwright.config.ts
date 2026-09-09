import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

// Strict assertions: recording is a separate, explicit approval command.
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}",
  timeout: 90_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
  // Missing and changed baselines both fail without modifying the baseline files.
  updateSnapshots: "none",
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: 1,
    baseURL: "http://127.0.0.1:6007",
    contextOptions: { reducedMotion: "reduce" },
  },
  webServer: {
    command: "npx storybook dev -p 6007 --ci --no-open",
    cwd: root,
    url: "http://127.0.0.1:6007/iframe.html",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
