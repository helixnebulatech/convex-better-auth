import { describe, expect, it } from "vitest";
import type { AuthConfig } from "convex/server";
import { betterAuth } from "better-auth/minimal";
import type { BetterAuthOptions } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { admin } from "better-auth/plugins/admin";
import { twoFactor } from "better-auth/plugins/two-factor";
import { jwt as jwtPlugin } from "better-auth/plugins/jwt";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import type { MemoryDB } from "better-auth/adapters/memory";
import { getAuthConfigProvider } from "../../auth-config.js";
import { convex } from "./index.js";

const authConfig = {
  providers: [{ applicationID: "convex", domain: "https://example.com" }],
} satisfies AuthConfig;

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
    // The get-session hook swallows token errors, so this fails silently
    const session = await request(auth, "/get-session", {
      headers: { cookie },
    });
    expect(
      session.headers.getSetCookie().some((c) => c.includes("convex_jwt=ey"))
    ).toBe(true);
    // Sign-up doesn't sign one, like Better Auth's jwt plugin
    expect(setCookies.some((c) => c.includes("convex_jwt=ey"))).toBe(false);
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

describe("convex plugin default JWT payload", () => {
  // Same user setup for Better Auth's own jwt plugin and ours: plugin fields,
  // a returned additional field and a `returned: false` one.
  const makeParityAuth = (plugins: BetterAuthOptions["plugins"]) => {
    process.env.CONVEX_SITE_URL = baseURL;
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
    };
    return betterAuth({
      baseURL,
      secret: "test-secret-at-least-thirty-two-characters-long",
      emailAndPassword: { enabled: true },
      user: {
        additionalFields: {
          plan: { type: "string", required: false, defaultValue: "free" },
          internalNote: {
            type: "string",
            required: false,
            defaultValue: "hidden",
            returned: false,
          },
        },
      },
      database: (options: BetterAuthOptions) => {
        const adapter = memoryAdapter(db)(options);
        return {
          ...adapter,
          options: { ...adapter.options, isRunMutationCtx: true },
        };
      },
      plugins: [admin(), ...(plugins ?? [])],
    });
  };
  type ParityAuth = ReturnType<typeof makeParityAuth>;

  const credentials = {
    email: "parity@example.com",
    password: "testpassword123",
    name: "Parity",
    image: "https://example.com/avatar.png",
  };
  const post = (auth: ParityAuth, path: string, body: object) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  const cookiesOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const jwtCookieOf = (res: Response) =>
    /better-auth\.convex_jwt=([^;]+)/.exec(cookiesOf(res))?.[1];
  const claimNames = (token: string) => {
    const {
      iat: _iat,
      exp: _exp,
      iss: _iss,
      aud: _aud,
      sub: _sub,
      ...claims
    } = decodeJwt(token);
    return Object.keys(claims).sort();
  };

  it("holds the same user fields as Better Auth's jwt plugin, minus id and image", async () => {
    const native = makeParityAuth([jwtPlugin()]);
    const nativeCookie = cookiesOf(
      await post(native, "/sign-up/email", credentials)
    );
    const nativeToken = (
      await (
        await native.handler(
          new Request(`${baseURL}/api/auth/token`, {
            headers: { cookie: nativeCookie },
          })
        )
      ).json()
    ).token;
    const nativeClaims = claimNames(nativeToken);
    expect(nativeClaims).toContain("plan");
    expect(nativeClaims).toContain("role");
    expect(nativeClaims).not.toContain("internalNote");
    const expected = nativeClaims
      .filter((name) => name !== "id" && name !== "image")
      .concat("sessionId")
      .sort();

    const ours = makeParityAuth([
      convex({ authConfig: { providers: [getAuthConfigProvider()] } }),
    ]);
    const signUp = await post(ours, "/sign-up/email", credentials);
    const signIn = await post(ours, "/sign-in/email", {
      email: credentials.email,
      password: credentials.password,
    });
    const tokenRes = await ours.handler(
      new Request(`${baseURL}/api/auth/convex/token`, {
        headers: { cookie: cookiesOf(signIn) },
      })
    );
    const session = await ours.handler(
      new Request(`${baseURL}/api/auth/get-session`, {
        headers: { cookie: cookiesOf(signIn) },
      })
    );
    expect(signUp.status).toBe(200);
    const tokens = {
      getSessionCookie: jwtCookieOf(session)!,
      tokenEndpoint: (await tokenRes.json()).token,
    };
    for (const token of Object.values(tokens)) {
      expect(claimNames(token)).toEqual(expected);
    }
  });

  it("keeps date claims as epoch milliseconds", async () => {
    const auth = makeParityAuth([
      convex({ authConfig: { providers: [getAuthConfigProvider()] } }),
    ]);
    const signUp = await post(auth, "/sign-up/email", credentials);
    const session = await auth.handler(
      new Request(`${baseURL}/api/auth/get-session`, {
        headers: { cookie: cookiesOf(signUp) },
      })
    );
    const claims = decodeJwt(jwtCookieOf(session)!);
    expect(typeof claims.createdAt).toBe("number");
    expect(typeof claims.updatedAt).toBe("number");
  });
});

describe("convex plugin with Better Auth's jwt plugin", () => {
  const build = (order: "convex,jwt" | "jwt,convex") => {
    process.env.CONVEX_SITE_URL = baseURL;
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
    };
    const convexPlugin = convex({
      authConfig: { providers: [getAuthConfigProvider()] },
    });
    const auth = betterAuth({
      baseURL,
      secret: "test-secret-at-least-thirty-two-characters-long",
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      database: (options: BetterAuthOptions) => {
        const adapter = memoryAdapter(db)(options);
        return {
          ...adapter,
          options: { ...adapter.options, isRunMutationCtx: true },
        };
      },
      plugins:
        order === "convex,jwt"
          ? [convexPlugin, jwtPlugin()]
          : [jwtPlugin(), convexPlugin],
    });
    return { auth, db };
  };
  const signedIn = async (auth: ReturnType<typeof build>["auth"]) => {
    const signUp = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "both@example.com",
          password: "testpassword123",
          name: "Both",
        }),
      })
    );
    const cookie = signUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    return (path: string) =>
      auth.handler(
        new Request(`${baseURL}/api/auth${path}`, { headers: { cookie } })
      );
  };

  // Either plugin may create the first key in the shared jwks table
  for (const order of ["convex,jwt", "jwt,convex"] as const) {
    for (const firstKey of ["/convex/jwks", "/jwks"]) {
      it(`keeps both plugins working with ${order}, first key from ${firstKey}`, async () => {
        const { auth } = build(order);
        const get = await signedIn(auth);
        expect((await get(firstKey)).status).toBe(200);
        for (const path of [
          "/convex/token",
          "/convex/jwks",
          "/convex/.well-known/openid-configuration",
          "/token",
          "/jwks",
        ]) {
          const res = await get(path);
          expect(res.status, `${path}: ${await res.clone().text()}`).toBe(200);
        }
        // Convex only accepts the algorithm in its auth config, RS256
        const convexJwks = await (await get("/convex/jwks")).json();
        expect(convexJwks.keys.map((k: { alg: string }) => k.alg)).toEqual([
          "RS256",
        ]);
        const { token: convexToken } = await (
          await get("/convex/token")
        ).json();
        await expect(
          jwtVerify(convexToken, createLocalJWKSet(convexJwks), {
            algorithms: ["RS256"],
          })
        ).resolves.toBeTruthy();
        // The jwt plugin signs with its latest key of any algorithm when it has
        // none in its own, as Better Auth does, and its JWKS publishes it
        const { token } = await (await get("/token")).json();
        await expect(
          jwtVerify(token, createLocalJWKSet(await (await get("/jwks")).json()))
        ).resolves.toBeTruthy();
      });
    }
  }

  it("rotates and exports only the Convex keys", async () => {
    const { auth, db } = build("jwt,convex");
    const get = await signedIn(auth);
    await get("/jwks");
    await get("/convex/token");
    const otherKeys = () =>
      (db.jwks as { id: string; alg: string }[])
        .filter((k) => k.alg !== "RS256")
        .map((k) => k.id);
    const before = otherKeys();
    expect(before).toHaveLength(1);
    const rotated = await auth.api.rotateKeys();
    expect(otherKeys()).toEqual(before);
    expect(rotated).toHaveLength(1);
    expect(rotated[0].alg).toBe("RS256");
    // A newer key of the jwt plugin isn't exported as the Convex key
    db.jwks.push({
      ...db.jwks.find((k: { alg: string }) => k.alg !== "RS256"),
      id: "newer-eddsa",
      createdAt: new Date(Date.now() + 60_000),
    });
    const latest = await auth.api.getLatestJwks();
    expect(latest[0].id).toBe(rotated[0].id);
    expect(latest[0].alg).toBe("RS256");
  });
});

describe("convex plugin JWT cookie", () => {
  const build = (order: "convex,twoFactor" | "twoFactor,convex") => {
    process.env.CONVEX_SITE_URL = baseURL;
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
      jwks: [],
      twoFactor: [],
    };
    const convexPlugin = convex({
      authConfig: { providers: [getAuthConfigProvider()] },
    });
    const auth = betterAuth({
      baseURL,
      secret: "test-secret-at-least-thirty-two-characters-long",
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      database: (options: BetterAuthOptions) => {
        const adapter = memoryAdapter(db)(options);
        return {
          ...adapter,
          options: { ...adapter.options, isRunMutationCtx: true },
        };
      },
      plugins:
        order === "convex,twoFactor"
          ? [convexPlugin, twoFactor()]
          : [twoFactor(), convexPlugin],
    });
    return { auth, db };
  };
  const call = (
    auth: ReturnType<typeof build>["auth"],
    path: string,
    { body, cookie }: { body?: object; cookie?: string } = {}
  ) =>
    auth.handler(
      new Request(`${baseURL}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    );
  const credentials = {
    email: "jwt@example.com",
    password: "testpassword123",
  };
  const cookiesOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
  const jwtOf = (res: Response) =>
    /better-auth\.convex_jwt=([^;]*)/.exec(
      res.headers.getSetCookie().join("\n")
    )?.[1];

  for (const order of ["convex,twoFactor", "twoFactor,convex"] as const) {
    it(`signs no JWT while 2FA is pending, with ${order}`, async () => {
      const { auth, db } = build(order);
      await call(auth, "/sign-up/email", {
        body: { ...credentials, name: "JWT" },
      });
      db.user[0]!.twoFactorEnabled = true;
      db.twoFactor.push({
        id: "tf",
        userId: db.user[0]!.id,
        secret: "secret",
        backupCodes: "codes",
        verified: true,
      });
      const signIn = await call(auth, "/sign-in/email", { body: credentials });
      expect((await signIn.json()).twoFactorRedirect).toBe(true);
      expect(jwtOf(signIn) ?? "").toBe("");
    });
  }

  it("drops the previous JWT on sign-in and sets one from get-session", async () => {
    const { auth } = build("twoFactor,convex");
    await call(auth, "/sign-up/email", {
      body: { ...credentials, name: "JWT" },
    });
    const signIn = await call(auth, "/sign-in/email", {
      body: credentials,
      cookie: "better-auth.convex_jwt=previous-user-jwt",
    });
    expect(signIn.status).toBe(200);
    expect(jwtOf(signIn)).toBe("");
    const session = await call(auth, "/get-session", {
      cookie: cookiesOf(signIn),
    });
    expect(jwtOf(session)).toMatch(/^ey/);
    const token = await call(auth, "/convex/token", {
      cookie: cookiesOf(signIn),
    });
    expect(jwtOf(token)).toMatch(/^ey/);
    expect((await token.json()).token).toMatch(/^ey/);
  });

  it("signs no JWT for an expired session", async () => {
    const { auth, db } = build("twoFactor,convex");
    const signUp = await call(auth, "/sign-up/email", {
      body: { ...credentials, name: "JWT" },
    });
    db.session[0]!.expiresAt = new Date(Date.now() - 1000);
    const session = await call(auth, "/get-session", {
      cookie: cookiesOf(signUp),
    });
    expect(await session.json()).toBeNull();
    expect(jwtOf(session)).toBe("");
    expect(
      (await call(auth, "/convex/token", { cookie: cookiesOf(signUp) })).status
    ).toBe(401);
  });
});
