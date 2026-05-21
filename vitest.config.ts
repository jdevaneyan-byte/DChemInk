import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    // Playwright owns tests/e2e; keep Vitest scoped to unit/integration tests.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
