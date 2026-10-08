import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(import.meta.dirname, ".env.test") });

const mockOAuthUrl = new URL(process.env.MOCK_OAUTH_URL!);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:5176",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // The no-referrer OAuth test rewrites the app's document headers with
        // page.route, which Chromium's local network access checks treat as an
        // unknown origin and then block requests to the backend on 127.0.0.1.
        launchOptions: {
          args: ["--disable-features=LocalNetworkAccessChecks"],
        },
      },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    // WebKit needs system libraries (`playwright install-deps webkit`, root),
    // so it's opt-in: E2E_WEBKIT=1 pnpm run test:e2e
    ...(process.env.E2E_WEBKIT
      ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
  webServer: [
    {
      // Mock OAuth provider for oauth.spec.ts
      command: "node mock-oauth-provider.mjs",
      cwd: import.meta.dirname,
      url: new URL("/health", mockOAuthUrl).toString(),
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        MOCK_OAUTH_HOST: mockOAuthUrl.hostname,
        MOCK_OAUTH_PORT: mockOAuthUrl.port,
      },
    },
    {
      command: "pnpm exec vite --port 5176 --clearScreen false",
      cwd: path.resolve(import.meta.dirname, "../examples/react"),
      url: "http://localhost:5176",
      reuseExistingServer: false,
      env: {
        VITE_CONVEX_URL: process.env.VITE_CONVEX_URL!,
        VITE_CONVEX_SITE_URL: process.env.VITE_CONVEX_SITE_URL!,
        VITE_SITE_URL: process.env.VITE_SITE_URL!,
        // Shows the "Sign in with Mock" button
        VITE_MOCK_OAUTH: "true",
      },
    },
  ],
});
