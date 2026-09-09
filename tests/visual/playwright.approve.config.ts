import { defineConfig } from "@playwright/test";
import strict from "./playwright.config";

// Deliberate local review only; CI must never approve its own results.
if (process.env.CI) throw new Error("Screenshot approval is disabled in CI. Run strict visual tests.");
export default defineConfig(strict, { updateSnapshots: "all" });
