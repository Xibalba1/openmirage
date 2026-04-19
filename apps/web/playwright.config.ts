import { defineConfig } from "@playwright/test";

const baseURL = process.env.OPENMIRAGE_E2E_BASE_URL ?? "http://127.0.0.1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    trace: "retain-on-failure"
  }
});
