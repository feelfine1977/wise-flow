import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Visual regression against the Storybook stories. Baselines live next to
 * the spec in `__screenshots__/` and are created on the first run
 * (`npx playwright test -c tests/visual/playwright.config.ts --update-snapshots`).
 */
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFileName}/{arg}-{platform}{ext}",
  timeout: 90_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: "disabled" } },
  // Baselines are recorded per platform; a missing baseline is written, not failed.
  updateSnapshots: "missing",
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
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
