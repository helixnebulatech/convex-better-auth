import { afterEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { getAuthConfigProvider } from "../auth-config.js";
import { convex } from "../plugins/convex/index.js";
import { getToken } from "./index.js";

const SITE_URL = "https://test.convex.site";

const setup = () =>
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () =>
      new Response(JSON.stringify({ token: "jwt" }), {
        headers: { "content-type": "application/json" },
      })
  );

const sentHeaders = (spy: ReturnType<typeof setup>) => {
  const [input, init] = spy.mock.calls[0] ?? [];
  return new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined)
  );
};

describe("getToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // get-convex/better-auth#422: callers pass the inbound request headers, and
  // hosting platforms (Vercel, Cloudflare, ...) set x-forwarded-host to the
  // app domain. Convex's edge routes on that header, so it must not reach the
  // Convex site; the component restores it from x-better-auth-forwarded-host.
  it("moves an inbound x-forwarded-host to x-better-auth-forwarded-host", async () => {
    const fetchSpy = setup();
    const headers = new Headers({
      "x-forwarded-host": "app.example.com",
      "x-forwarded-proto": "https",
    });

    const result = await getToken(SITE_URL, headers);

    expect(result.token).toBe("jwt");
    const sent = sentHeaders(fetchSpy);
    expect(sent.get("host")).toBe(new URL(SITE_URL).host);
    expect(sent.get("x-forwarded-host")).toBeNull();
    expect(sent.get("x-better-auth-forwarded-host")).toBe("app.example.com");
    expect(sent.get("x-better-auth-forwarded-proto")).toBe("https");
  });

  it("keeps an existing x-better-auth-forwarded-host", async () => {
    const fetchSpy = setup();
    const headers = new Headers({
      "x-forwarded-host": "proxy.internal.example.com",
      "x-better-auth-forwarded-host": "app.example.com",
    });

    await getToken(SITE_URL, headers);

    const sent = sentHeaders(fetchSpy);
    expect(sent.get("x-forwarded-host")).toBeNull();
    expect(sent.get("x-better-auth-forwarded-host")).toBe("app.example.com");
  });

  it("does not add forwarding headers when none were sent", async () => {
    const fetchSpy = setup();

    await getToken(SITE_URL, new Headers({ cookie: "a=1" }));

    const sent = sentHeaders(fetchSpy);
    expect(sent.get("cookie")).toBe("a=1");
    expect(sent.get("x-forwarded-host")).toBeNull();
    expect(sent.get("x-better-auth-forwarded-host")).toBeNull();
    expect(sent.get("x-better-auth-forwarded-proto")).toBeNull();
  });
});

// Signs real tokens with the convex plugin. Each instance gets its own site
// URL, since verification keys are cached per JWKS URL for the process.
let siteCount = 0;
const makeAuth = () => {
  const site = `https://jwt-${++siteCount}.convex.site`;
  process.env.CONVEX_SITE_URL = site;
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const auth = betterAuth({
    baseURL: site,
    secret: "test-secret-at-least-thirty-two-characters-long",
    emailAndPassword: { enabled: true },
    database: (options: BetterAuthOptions) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...adapter.options, isRunMutationCtx: true },
      };
    },
    plugins: [convex({ authConfig: { providers: [getAuthConfigProvider()] } })],
  });
  return { auth, site, db };
};
type Auth = ReturnType<typeof makeAuth>["auth"];

const signUpJwt = async (
  { auth, site }: ReturnType<typeof makeAuth>,
  email = "user@example.com"
) => {
  const res = await auth.handler(
    new Request(`${site}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        password: "testpassword123",
        name: "User",
      }),
    })
  );
  expect(res.status).toBe(200);
  const jwt = res.headers
    .getSetCookie()
    .map((cookie) => /better-auth\.convex_jwt=([^;]+)/.exec(cookie)?.[1])
    .find(Boolean);
  expect(jwt).toBeTruthy();
  return jwt!;
};

// Serves fetch from the auth instance, recording the requested paths
const routeFetchTo = (auth: Auth) => {
  const paths: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    paths.push(new URL(request.url).pathname);
    return auth.handler(request);
  });
  return paths;
};

const jwtCookie = (jwt: string) =>
  new Headers({ cookie: `better-auth.convex_jwt=${jwt}` });
const jwtCache = { enabled: true, isAuthError: () => true };
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe("getToken jwtCache", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not reuse an unsigned cookie JWT", async () => {
    const instance = makeAuth();
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const forged = `${encode({ alg: "none" })}.${encode({
      sub: "user",
      iss: instance.site,
      aud: "convex",
      exp: nowSeconds() + 3600,
    })}.`;
    const paths = routeFetchTo(instance.auth);

    const result = await getToken(instance.site, jwtCookie(forged), {
      jwtCache,
    });

    expect(result).toEqual({ isFresh: true, token: undefined });
    expect(paths).toContain("/api/auth/convex/token");
  });

  it("does not reuse a cookie JWT signed with an unknown key", async () => {
    const instance = makeAuth();
    const { privateKey } = await jose.generateKeyPair("RS256");
    const forged = await new jose.SignJWT({ sub: "user" })
      .setProtectedHeader({ alg: "RS256", kid: "unknown" })
      .setIssuer(instance.site)
      .setAudience("convex")
      .setExpirationTime("1h")
      .sign(privateKey);
    const paths = routeFetchTo(instance.auth);

    const result = await getToken(instance.site, jwtCookie(forged), {
      jwtCache,
    });

    expect(result).toEqual({ isFresh: true, token: undefined });
    expect(paths).toContain("/api/auth/convex/token");
  });

  it("does not reuse a signed cookie JWT for another issuer", async () => {
    const instance = makeAuth();
    const jwt = await signUpJwt(instance);
    routeFetchTo(instance.auth);

    const result = await getToken(instance.site, jwtCookie(jwt), {
      jwtCache: { ...jwtCache, issuer: "https://other.convex.site" },
    });

    expect(result.isFresh).toBe(true);
  });

  it("reuses a signed cookie JWT, fetching the JWKS once", async () => {
    const instance = makeAuth();
    const jwt = await signUpJwt(instance);
    const paths = routeFetchTo(instance.auth);

    for (let i = 0; i < 3; i++) {
      const result = await getToken(instance.site, jwtCookie(jwt), {
        jwtCache,
      });
      expect(result).toEqual({ isFresh: false, token: jwt });
    }
    expect(paths).toEqual(["/api/auth/convex/jwks"]);
  });

  it("verifies against a static JWKS without network requests", async () => {
    const instance = makeAuth();
    const jwt = await signUpJwt(instance);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await getToken(instance.site, jwtCookie(jwt), {
      jwtCache: { ...jwtCache, jwks: JSON.stringify(instance.db.jwks) },
    });

    expect(result).toEqual({ isFresh: false, token: jwt });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("picks up a rotated key after the JWKS refetch cooldown", async () => {
    const instance = makeAuth();
    const jwtA = await signUpJwt(instance);
    routeFetchTo(instance.auth);
    const run = (jwt: string) =>
      getToken(instance.site, jwtCookie(jwt), { jwtCache });
    expect((await run(jwtA)).isFresh).toBe(false);
    vi.restoreAllMocks();

    // Rotate: drop the old key, the next token is signed with a new one
    instance.db.jwks = [];
    const jwtB = await signUpJwt(instance, "other@example.com");
    expect(jose.decodeProtectedHeader(jwtB).kid).not.toBe(
      jose.decodeProtectedHeader(jwtA).kid
    );
    const paths = routeFetchTo(instance.auth);
    // Unknown kid within the cooldown: falls back to a fresh token
    expect((await run(jwtB)).isFresh).toBe(true);
    expect(paths).toContain("/api/auth/convex/token");

    vi.useFakeTimers({ now: Date.now() + 31_000, toFake: ["Date"] });
    expect((await run(jwtB)).isFresh).toBe(false);
  }, 30_000);

  describe("expirationToleranceSeconds", () => {
    const at = async (secondsBeforeExp: number, tolerance?: number) => {
      const instance = makeAuth();
      const jwt = await signUpJwt(instance);
      routeFetchTo(instance.auth);
      const exp = jose.decodeJwt(jwt).exp!;
      vi.useFakeTimers({
        now: (exp - secondsBeforeExp) * 1000,
        toFake: ["Date"],
      });
      try {
        return await getToken(instance.site, jwtCookie(jwt), {
          jwtCache: { ...jwtCache, expirationToleranceSeconds: tolerance },
        });
      } finally {
        vi.useRealTimers();
      }
    };

    it("refreshes a token that expired within the tolerance", async () => {
      expect((await at(-30)).isFresh).toBe(true);
    });

    it("refreshes a token expiring within the tolerance", async () => {
      expect((await at(30)).isFresh).toBe(true);
      expect((await at(90, 120)).isFresh).toBe(true);
    });

    it("reuses a token expiring after the tolerance", async () => {
      expect((await at(90)).isFresh).toBe(false);
      expect((await at(30, 10)).isFresh).toBe(false);
    });
  });
});
