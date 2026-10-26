import { defineConfig } from "vitest/config";

// Browser tests (Playwright/Chromium). Kept out of `npm test` so unit tests
// stay fast and don't need a browser installed.
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
