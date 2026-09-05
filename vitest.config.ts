import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/core/**/*.test.ts", "tests/react/**/*.test.tsx"],
    environmentMatchGlobs: [["tests/react/**", "jsdom"]],
    setupFiles: ["tests/react/setup.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
