import { describe, expect, it, vi } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { magicLink } from "better-auth/plugins/magic-link";
import { crossDomain } from "./index.js";

const SITE_URL = "https://myapp.example.com";
const AUTH_BASE_URL = "http://localhost:3000";
const BASE_PATH = "/api/auth";

describe("crossDomain plugin", async () => {
  let capturedMagicLinkUrl = "";
  const loggedErrors: string[] = [];

  const db: MemoryDB = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };

  const auth = betterAuth({
    baseURL: AUTH_BASE_URL,
    basePath: BASE_PATH,
    secret: "test-secret-at-least-thirty-two-characters-long",
    database: memoryAdapter(db),
    logger: {
      log: (level, message) => {
        if (level === "error") {
          loggedErrors.push(message);
        }
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          capturedMagicLinkUrl = url;
        },
      }),
      genericOAuth({
        config: [
          {
            providerId: "example-oauth",
            clientId: "test-client-id",
            clientSecret: "test-client-secret",
            authorizationUrl: "https://provider.example.com/oauth/authorize",
            tokenUrl: "https://provider.example.com/oauth/token",
          },
        ],
      }),
      crossDomain({ siteUrl: SITE_URL }),
    ],
  });

  const post = (
    path: string,
    body: Record<string, unknown>,
    extraHeaders?: Record<string, string>
  ) =>
    auth.handler(
      new Request(`${AUTH_BASE_URL}${BASE_PATH}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(body),
      })
    );

  await post("/sign-up/email", {
    email: "test@example.com",
    password: "testpassword123",
    name: "Test User",
  });

  describe("callbackURL defaulting for magic-link", () => {
    it("injects siteUrl when callbackURL is absent", async () => {
      capturedMagicLinkUrl = "";
      await post("/sign-in/magic-link", { email: "test@example.com" });
      const url = new URL(capturedMagicLinkUrl);
      expect(url.searchParams.get("callbackURL")).toBe(SITE_URL);
    });

    it("rewrites relative callbackURL to absolute using siteUrl", async () => {
      capturedMagicLinkUrl = "";
      await post("/sign-in/magic-link", {
        email: "test@example.com",
        callbackURL: "/dashboard",
      });
      const url = new URL(capturedMagicLinkUrl);
      expect(url.searchParams.get("callbackURL")).toBe(`${SITE_URL}/dashboard`);
    });

    it("preserves absolute callbackURL", async () => {
      capturedMagicLinkUrl = "";
      await post("/sign-in/magic-link", {
        email: "test@example.com",
        callbackURL: "https://other.example.com/callback",
      });
      const url = new URL(capturedMagicLinkUrl);
      expect(url.searchParams.get("callbackURL")).toBe(
        "https://other.example.com/callback"
      );
    });
  });

  describe("callbackURL defaulting for generic OAuth", () => {
    it("injects siteUrl when callbackURL is absent", async () => {
      const response = await post("/sign-in/social", {
        provider: "example-oauth",
        disableRedirect: true,
      });
      const { url } = (await response.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      const verification = db.verification.find(
        (entry) => entry.identifier === `auth-state:${state}`
      );
      expect(verification).toBeDefined();
      expect(JSON.parse(verification!.value).callbackURL).toBe(SITE_URL);
    });

    it("rewrites relative callbackURL to absolute using siteUrl", async () => {
      const response = await post("/sign-in/social", {
        provider: "example-oauth",
        callbackURL: "/dashboard",
        disableRedirect: true,
      });
      const { url } = (await response.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      const verification = db.verification.find(
        (entry) => entry.identifier === `auth-state:${state}`
      );
      expect(verification).toBeDefined();
      expect(JSON.parse(verification!.value).callbackURL).toBe(
        `${SITE_URL}/dashboard`
      );
    });
  });

  describe("no callbackURL injection for email sign-in", () => {
    it("does not redirect when callbackURL is absent", async () => {
      const response = await post("/sign-in/email", {
        email: "test@example.com",
        password: "testpassword123",
      });
      expect(response.status).not.toBe(302);
    });
  });

  describe("one-time-token handoff on callbacks", () => {
    it("does not log an error when the callback creates no session", async () => {
      loggedErrors.length = 0;
      const response = await auth.handler(
        new Request(
          `${AUTH_BASE_URL}${BASE_PATH}/magic-link/verify?token=invalid&callbackURL=${encodeURIComponent(SITE_URL)}`
        )
      );
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(location.searchParams.get("error")).toBe("INVALID_TOKEN");
      expect(location.searchParams.has("ott")).toBe(false);
      expect(loggedErrors).not.toContain("No session found");
    });

    it("appends a one-time token when the callback creates a session", async () => {
      capturedMagicLinkUrl = "";
      await post("/sign-in/magic-link", { email: "test@example.com" });
      const response = await auth.handler(new Request(capturedMagicLinkUrl));
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("location")!);
      expect(location.origin).toBe(SITE_URL);
      expect(location.searchParams.get("ott")).toMatch(/^.{32}$/);
    });
  });

  describe("Better-Auth-Cookie header", () => {
    it("keeps the session when the request also has a Cookie header", async () => {
      const signIn = await post(
        "/sign-up/email",
        {
          email: "cookie@example.com",
          password: "testpassword123",
          name: "Cookie User",
        },
        { "better-auth-cookie": "" }
      );
      expect(signIn.status).toBe(200);
      const setCookie = signIn.headers.get("set-better-auth-cookie")!;
      const sessionCookie = setCookie.split(";")[0];
      expect(sessionCookie).toContain("session_token=");

      // Deno and Cloudflare Workers join appended cookie values with ", ".
      const append = Headers.prototype.append;
      const spy = vi
        .spyOn(Headers.prototype, "append")
        .mockImplementation(function (this: Headers, name, value) {
          const existing = this.get(name);
          if (name.toLowerCase() === "cookie" && existing) {
            this.set(name, `${existing}, ${value}`);
            return;
          }
          append.call(this, name, value);
        });
      try {
        const response = await auth.handler(
          new Request(`${AUTH_BASE_URL}${BASE_PATH}/get-session`, {
            headers: {
              cookie: "theme=dark",
              "Better-Auth-Cookie": sessionCookie,
            },
          })
        );
        const session = (await response.json()) as {
          user?: { email: string };
        } | null;
        expect(session?.user?.email).toBe("cookie@example.com");
      } finally {
        spy.mockRestore();
      }
    });
  });
});
