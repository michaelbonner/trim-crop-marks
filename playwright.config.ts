import { defineConfig } from "@playwright/test";

const externalServer = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: "./tests",
  testMatch: "*.spec.ts",
  fullyParallel: true,
  use: { baseURL: externalServer ?? "http://localhost:5174" },
  webServer: externalServer
    ? undefined
    : {
        command: "bun run build && bun run preview --port 5174",
        url: "http://localhost:5174",
        reuseExistingServer: !process.env.CI,
      },
});
