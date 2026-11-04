import { afterEach, describe, expect, it, vi } from "vitest";
import { httpRouter } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth";
import { createClient } from "./create-client.js";

// End-to-end: a dynamic baseURL with a wildcard in allowedHosts, requests
// arriving through registerRoutes the way Convex delivers them. The emailed
// password reset link shows which origin Better Auth resolved. Better Auth
// only reads x-forwarded-* with advanced.trustedProxyHeaders, and otherwise
// the Host header, then the request URL.
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

const setup = async (advanced?: BetterAuthOptions["advanced"]) => {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  let resetUrl = "";
  const auth = betterAuth({
    baseURL: {
      allowedHosts: [APP_HOST, ADMIN_HOST, "*.example-previews.app"],
      fallback: `https://${APP_HOST}`,
    },
    basePath: "/api/auth",
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    logger: { disabled: true },
    advanced,
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ url }) => {
        resetUrl = url;
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

  // `origin` is what the request arrives as: on Convex's cloud the edge sets
  // the URL, Host and x-forwarded-* to the deployment; a self-hosted backend
  // builds them from whatever the client sent.
  return async (headers: Record<string, string>, origin = CONVEX_SITE) => {
    resetUrl = "";
    const response = await handler(
      {},
      new Request(`${origin}/api/auth/request-password-reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          host: new URL(origin).host,
          "x-forwarded-host": new URL(origin).host,
          "x-forwarded-proto": new URL(origin).protocol.slice(0, -1),
          ...headers,
        },
        body: JSON.stringify({ email: "victim@example.com" }),
      })
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(resetUrl).not.toBe("");
    return new URL(resetUrl);
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each([
  ["trusted", { trustedProxyHeaders: true }],
  ["not trusted", undefined],
] as const)("dynamic baseURL, proxy headers %s", async (_name, advanced) => {
  const requestReset = await setup(advanced);

  it("builds links from the fallback with no original host", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    expect((await requestReset({})).origin).toBe(`https://${APP_HOST}`);
  });

  // Without trustedProxyHeaders, Better Auth reads the Host header, which
  // used to stay the Convex site's, so the original host was ignored
  it("uses an exactly listed original origin", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.origin).toBe(`https://${ADMIN_HOST}`);
  });

  it("ignores an original host that only matches a wildcard", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({
      "x-better-auth-forwarded-host": PREVIEW_HOST,
      "x-better-auth-forwarded-proto": "https",
    });
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  it("does not downgrade an exactly listed original host to http", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({
      "x-better-auth-forwarded-host": ADMIN_HOST,
      "x-better-auth-forwarded-proto": "http",
    });
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  // A self-hosted Convex backend passes a client's Host and x-forwarded-*
  // through to the HTTP action and builds the request URL from them, unlike
  // Convex's cloud edge, which replaces them
  it("ignores an x-forwarded-host a client sent straight to the backend", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({
      "x-forwarded-host": PREVIEW_HOST,
      "x-forwarded-proto": "https",
    });
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  it("ignores a client-sent Host and URL that match a wildcard", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `https://${PREVIEW_HOST}`);
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  it("ignores a client-sent Host alone that matches a wildcard", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({ host: PREVIEW_HOST });
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  it("does not downgrade a client-sent listed host to http", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `http://${ADMIN_HOST}`);
    expect(url.origin).toBe(`https://${APP_HOST}`);
  });

  it("keeps a request that arrives at an exactly listed origin", async () => {
    vi.stubEnv("CONVEX_SITE_URL", CONVEX_SITE);
    const url = await requestReset({}, `https://${ADMIN_HOST}`);
    expect(url.origin).toBe(`https://${ADMIN_HOST}`);
  });
});
