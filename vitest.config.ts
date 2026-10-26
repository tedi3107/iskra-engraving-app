import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that one loads the React Router
// plugin, which tests don't need. The cart-transform extension has its own
// vitest setup (it needs a wasm build), so it is excluded here.
export default defineConfig({
  test: {
    include: ["app/**/*.test.ts", "extensions/engraving-preview/tests/**/*.test.ts"],
    exclude: ["node_modules", "extensions/engraving-cart-transform/**"],
  },
});
