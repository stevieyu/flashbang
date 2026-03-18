import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 3456);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: BASE_URL,
  },
  webServer: {
    command: "bun run start",
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    url: `${BASE_URL}/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
