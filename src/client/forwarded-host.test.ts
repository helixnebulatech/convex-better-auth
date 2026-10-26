import { describe, expect, it } from "vitest";
import { httpRouter } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { createClient } from "./create-client.js";

// End-to-end: a dynamic baseURL with a wildcard in allowedHosts, requests
// arriving through registerRoutes the way Convex delivers them. Better Auth
// only reads x-forwarded-* with advanced.trustedProxyHeaders.
const APP_HOST = "myapp.example.com";
const ADMIN_HOST = "admin.example.com";
const PREVIEW_HOST = "branch-abc.example-previews.app";
const CONVEX_SITE = "https://deployment.convex.site";

const component = {
  adapter: {
    create: "create",
    findOne: "findOne",
    findMany: "findMany",
    updateOne: "updateOne",
    updateMany: "updateMany",
    deleteOne: "deleteOne",
    deleteMany: "deleteMany",
  },
} as any;

const setup = async (trustedProxyHeaders: boolean) => {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const sent = { resetUrl: "" };
  const auth = betterAuth({
    baseURL: {
      allowedHosts: [APP_HOST, ADMIN_HOST, "*.example-previews.app"],
      fallback: `https://${APP_HOST}`,
    },
    basePath: "/api/auth",
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    logger: { disabled: true },
    advanced: { trustedProxyHeaders },
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ url }) => {
        sent.resetUrl = url;
      },
    },
  });

  await auth.handler(
    new Request(`https://${APP_HOST}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "victim@example.com",
        password: "testpassword123",
        name: "Victim",
      }),
    })
  );

  const http = httpRouter();
  createClient(component).registerRoutes(http, () => auth as any);
  const route = http.lookup("/api/auth/request-password-reset", "POST")!;
  const handler = (route[0] as any)._handler as (
    ctx: unknown,
    request: Request
  ) => Promise<Response>;

  return async (headers: Record<string, string>) => {
    sent.resetUrl = "";
    const response = await handler(
      {},
      new Request(`${CONVEX_SITE}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: new URL(CONVEX_SITE).host,
          "x-forwarded-host": new URL(CONVEX_SITE).host,
          "x-forwarded-proto": "https",
          ...headers,
        },
        body: JSON.stringify({ email: "victim@example.com" }),
      })
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(sent.resetUrl).not.toBe("");
    return new URL(sent.resetUrl);
  };
};

describe("forwarded host restore with dynamic baseURL", async () => {
  const requestReset = await setup(true);

  it("builds links from the fallback with no original host", async () => {
    expect((await requestReset({})).host).toBe(APP_HOST);
  });

  it("uses an exactly listed original host", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(ADMIN_HOST);
  });

  it("ignores an original host that only matches a wildcard", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": PREVIEW_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(APP_HOST);
  });
});

describe("forwarded host restore without trustedProxyHeaders", async () => {
  const requestReset = await setup(false);

  it("builds links from the fallback, even for a listed original host", async () => {
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.host).toBe(APP_HOST);
  });
});
