import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  use: { baseURL: "http://localhost:5174" },
  webServer: {
    command: "bun run build && bun run preview --port 5174",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
  },
});
