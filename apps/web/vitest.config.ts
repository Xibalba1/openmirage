import { jsdomTestConfig } from "@openmirage/config-test";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    ...jsdomTestConfig.test,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcovonly"]
    },
    include: ["src/**/*.vitest.test.ts", "src/**/*.vitest.test.tsx"],
    pool: "threads"
  }
});
