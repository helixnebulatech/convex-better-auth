import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import type { BetterAuthOptions } from "better-auth";
import { parseSetCookieHeader } from "better-auth/cookies";
import { twoFactor } from "better-auth/plugins/two-factor";
import { convex } from "../convex/index.js";
import { crossDomain } from "./index.js";

// A cross domain sign-in that twoFactor holds back. Better Auth runs the
// after hooks in plugin order, so whatever the order, every cookie of the
// response has to reach the cross domain client in Set-Better-Auth-Cookie.
const SITE_URL = "https://myapp.example.com";
const BASE_URL = "https://deployment.convex.site";

type Name = "crossDomain" | "convex" | "twoFactor";
const orders: Name[][] = [
  ["crossDomain", "convex", "twoFactor"],
  ["crossDomain", "twoFactor", "convex"],
  ["convex", "crossDomain", "twoFactor"],
  ["convex", "twoFactor", "crossDomain"],
  ["twoFactor", "crossDomain", "convex"],
  ["twoFactor", "convex", "crossDomain"],
];

const build = (order: Name[]) => {
  process.env.CONVEX_SITE_URL = BASE_URL;
  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    twoFactor: [],
  };
  const plugins = {
    crossDomain: () => crossDomain({ siteUrl: SITE_URL }),
    convex: () =>
      convex({
        authConfig: {
          providers: [
            {
              type: "customJwt",
              issuer: BASE_URL,
              applicationID: "convex",
              algorithm: "RS256",
              jwks: `${BASE_URL}/api/auth/convex/jwks`,
            } as any,
          ],
        },
      }),
    twoFactor: () => twoFactor(),
  };
  const auth = betterAuth({
    baseURL: BASE_URL,
    secret: "[SECRET]",
    emailAndPassword: { enabled: true },
    logger: { disabled: true },
    database: (options: BetterAuthOptions) => {
      const adapter = memoryAdapter(db)(options);
      return {
        ...adapter,
        options: { ...adapter.options, isRunMutationCtx: true },
      };
    },
    plugins: order.map((name) => plugins[name]()),
  });
  return { auth, db };
};

const credentials = {
  email: ["two-factor", "example.com"].join("@"),
  password: "[SECRET]",
};

describe.each(orders)(
  "cross domain sign-in held by 2FA, %s, %s, %s",
  (...order) => {
    it("hands every cookie to the client", async () => {
      const { auth, db } = build(order);
      const post = (path: string, body: object, cookie: string) =>
        auth.handler(
          new Request(`${BASE_URL}/api/auth${path}`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              origin: SITE_URL,
              "better-auth-cookie": cookie,
            },
            body: JSON.stringify(body),
          })
        );
      const signUp = await post(
        "/sign-up/email",
        { ...credentials, name: "Two Factor" },
        ""
      );
      expect(signUp.status, await signUp.clone().text()).toBe(200);
      db.user[0]!.twoFactorEnabled = true;
      db.twoFactor.push({
        id: "tf",
        userId: db.user[0]!.id,
        secret: "[SECRET]",
        backupCodes: "codes",
        verified: true,
      });

      const signIn = await post(
        "/sign-in/email",
        credentials,
        "__Secure-better-auth.convex_jwt=previous-user-jwt"
      );
      expect((await signIn.json()).twoFactorRedirect).toBe(true);
      // Nothing goes out as a plain cookie, which the client never reads,
      // and the internal marker doesn't leave the server
      expect(signIn.headers.getSetCookie()).toEqual([]);
      expect(signIn.headers.has("x-better-auth-cross-domain")).toBe(false);

      const cookies = parseSetCookieHeader(
        signIn.headers.get("set-better-auth-cookie") ?? ""
      );
      // The client needs the two_factor cookie to verify the code
      expect(
        cookies.get("__Secure-better-auth.two_factor")?.value
      ).toBeTruthy();
      // Secure prefix, as the auth server is https. The held session is
      // set and then expired, and the client keeps the last one, so it isn't
      // handed over, and the previous user's JWT
      // is dropped
      expect(
        cookies.get("__Secure-better-auth.session_token")?.value ?? ""
      ).toBe("");
      expect(cookies.get("__Secure-better-auth.convex_jwt")).toMatchObject({
        value: "",
        "max-age": 0,
      });
    });
  }
);
