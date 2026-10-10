import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "core", include: ["tests/core/**/*.test.ts"], exclude: ["tests/core/graph-size.test.ts"], environment: "node" } },
      // A million edges take up to about 1.6 GB of heap in one worker; run them after the other files, alone, so
      // parallel workers do not exhaust the memory of a small machine and kill that worker.
      { extends: true, test: { name: "core-large", include: ["tests/core/graph-size.test.ts"], environment: "node", sequence: { groupOrder: 1 } } },
      { extends: true, test: { name: "react", include: ["tests/react/**/*.test.tsx"], environment: "jsdom", setupFiles: ["tests/react/setup.ts"] } },
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    allowOnly: !process.env.CI,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: { junit: "reports/unit.xml" },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.d.ts"],
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
      // Whole-source Vitest 4 AST coverage; not comparable to Vitest 2's V8 counters.
      // The measured values rounded down; ratchet them upward as the remaining branches gain meaningful tests.
      thresholds: { statements: 93, lines: 95, branches: 84, functions: 92 },
    },
  },
});
