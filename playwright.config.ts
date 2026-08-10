import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      // :memory: gives every test run a fresh, empty database with zero
      // setup/teardown — the server process itself is the isolation
      // boundary, same idea as tests/helpers.ts's testDb() for Vitest.
      DATABASE_PATH: ":memory:",
      AUTO_SEED_DIR: "seeds",
      ADMIN_USERNAME: "e2e-admin",
      ADMIN_PASSWORD: "e2e-password",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
