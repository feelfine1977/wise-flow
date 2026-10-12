import { defineConfig } from "vitest/config";

const largeInputs = ["tests/core/graph-size.test.ts"];

export default defineConfig({
  test: {
    projects: [
      { extends: true, test: { name: "core", include: ["tests/core/**/*.test.ts"], exclude: [...largeInputs], environment: "node" } },
      // Holds a million-edge scene (about 1.9 GB per fork with coverage): run alone, after the others.
      { extends: true, test: { name: "large", include: largeInputs, environment: "node", sequence: { groupOrder: 1 }, maxWorkers: 1 } },
      { extends: true, test: { name: "react", include: ["tests/react/**/*.test.tsx"], environment: "jsdom", setupFiles: ["tests/react/setup.ts"] } },
    ],
    // Hosted runners have two to four cores; more forks than that only multiply the memory a run needs.
    maxWorkers: 4,
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
