import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { getAuthConfigProvider } from "../../auth-config.js";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

const getJwtSetCookieMatcher = () => {
  const plugin = convex({ authConfig });
  const afterHooks = plugin.hooks?.after ?? [];
  const matcher = afterHooks.find((hook) => {
    return (
      hook.matcher({
        path: "/sign-in/email",
        context: { session: { id: "s1" } },
      } as unknown as Parameters<typeof hook.matcher>[0]) &&
      !hook.matcher({
        path: "/sign-out",
        context: { session: null },
      } as unknown as Parameters<typeof hook.matcher>[0])
    );
  })?.matcher;
  if (!matcher) {
    throw new Error("Failed to find Convex JWT set-cookie after hook matcher");
  }
  return matcher;
};

describe("convex plugin JWT cookie refresh matcher", () => {
  it("matches update-session", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const ctx = {
      path: "/update-session",
      context: { session: { id: "s1" } },
    };
    expect(matcher(ctx as unknown as MatcherContext)).toBe(true);
  });

  it("matches get-session only when a session exists", () => {
    const matcher = getJwtSetCookieMatcher();
    type MatcherContext = Parameters<typeof matcher>[0];
    const withSessionCtx = {
      path: "/get-session",
      context: { session: { id: "s1" } },
    };
    const withoutSessionCtx = {
      path: "/get-session",
      context: { session: null },
    };
    expect(matcher(withSessionCtx as unknown as MatcherContext)).toBe(true);
    expect(matcher(withoutSessionCtx as unknown as MatcherContext)).toBe(false);
  });
});

describe("convex plugin OpenID configuration", () => {
  it("serves issuer and jwks_uri for the Convex site", async () => {
    process.env.CONVEX_SITE_URL = "https://example.convex.site";
    const auth = betterAuth({
      baseURL: "https://example.convex.site",
      secret: "test-secret-at-least-thirty-two-characters-long",
      database: memoryAdapter({ user: [], session: [], jwks: [] }),
      plugins: [convex({ authConfig })],
    });
    const response = await auth.handler(
      new Request(
        "https://example.convex.site/api/auth/convex/.well-known/openid-configuration"
      )
    );
    expect(response.status).toBe(200);
    const config = (await response.json()) as Record<string, unknown>;
    expect(config.issuer).toBe("https://example.convex.site");
    expect(config.jwks_uri).toBe(
      "https://example.convex.site/api/auth/convex/jwks"
    );
  });
});

const baseURL = "https://example.convex.site";

// Sign-up writes, so mark the adapter as running in a mutation ctx, otherwise
// the plugin no-ops writes as it does in query ctx.
const makeAuth = (
  convexOpts: Omit<Parameters<typeof convex>[0], "authConfig"> = {}
) => {
  process.env.CONVEX_SITE_URL = baseURL;
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const auth = betterAuth({
    baseURL,
    secret: "test-secret-at-least-thirty-two-characters-long",
    emailAndPassword: { enabled: true },
    database: (options: BetterAuthOptions) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...adapter.options, isRunMutationCtx: true },
      };
    },
    plugins: [
      convex({
        authConfig: {
          providers: [
            getAuthConfigProvider(
              convexOpts.jwks ? { jwks: convexOpts.jwks } : undefined
            ),
          ],
        },
        ...convexOpts,
      }),
    ],
  });
  return { auth, db };
};

const request = (
  auth: ReturnType<typeof makeAuth>["auth"],
  path: string,
  init?: RequestInit
) => auth.handler(new Request(`${baseURL}/api/auth${path}`, init));

describe("convex plugin static JWKS", async () => {
  // Real RS256 key rows, with dates as epoch millis like the Convex adapter
  // returns them, and so like `auth:getLatestJwks` / `auth:rotateKeys` print.
  const mintKey = async () => {
    const { auth, db } = makeAuth();
    expect((await request(auth, "/convex/jwks")).status).toBe(200);
    return db.jwks[0] as { id: string; publicKey: string; privateKey: string };
  };
  const [first, second] = await Promise.all([mintKey(), mintKey()]);
  const older = { ...first, createdAt: 1_700_000_000_000 };
  const newer = { ...second, createdAt: 1_700_000_000_090 };

  const signUp = async (auth: ReturnType<typeof makeAuth>["auth"]) => {
    const res = await request(auth, "/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "test@example.com",
        password: "testpassword123",
        name: "Test User",
      }),
    });
    expect(res.status).toBe(200);
    const setCookies = res.headers.getSetCookie();
    return {
      setCookies,
      cookie: setCookies.map((c) => c.split(";")[0]).join("; "),
    };
  };
  const kidOf = (token: string) =>
    JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).kid;

  it("signs with the newest key when the static JWKS holds several keys", async () => {
    const { auth } = makeAuth({ jwks: JSON.stringify([older, newer]) });
    const { cookie, setCookies } = await signUp(auth);
    const res = await request(auth, "/convex/token", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(kidOf((await res.json()).token)).toBe(newer.id);
    // The sign-in hook swallows token errors, so this fails silently
    expect(setCookies.some((c) => c.includes("convex_jwt=ey"))).toBe(true);
  });

  it("serves keys with expiresAt and drops expired ones", async () => {
    const { auth } = makeAuth({
      jwks: JSON.stringify([
        { ...older, expiresAt: 1_000 },
        { ...newer, expiresAt: null },
      ]),
    });
    const res = await request(auth, "/convex/jwks");
    expect(res.status).toBe(200);
    const { keys } = (await res.json()) as { keys: { kid: string }[] };
    expect(keys.map((key) => key.kid)).toEqual([newer.id]);
  });
});
