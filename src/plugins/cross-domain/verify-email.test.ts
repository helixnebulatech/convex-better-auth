import { describe, expect, it } from "vitest";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { crossDomain } from "./index.js";

const AUTH = "https://deploy.convex.site";
const BASE = `${AUTH}/api/auth`;
const SITE = "https://app.example.com";
const ADMIN = "https://admin.example.com";

// Like crossDomainClient: cookies travel in the Better-Auth-Cookie header
const clientHeaders = (cookie = "") => ({
  "content-type": "application/json",
  origin: SITE,
  "better-auth-cookie": cookie,
});

const build = (autoSignInAfterVerification: boolean) => {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const emails: string[] = [];
  const auth = betterAuth({
    baseURL: AUTH,
    secret: "cross-domain-test-secret-at-least-32-characters",
    database: memoryAdapter(db),
    trustedOrigins: [SITE, ADMIN],
    logger: { disabled: true },
    emailAndPassword: { enabled: true },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification,
      sendVerificationEmail: async ({ url }) => {
        emails.push(url);
      },
    },
    user: { changeEmail: { enabled: true } },
    plugins: [crossDomain({ siteUrl: SITE })],
  });
  return { auth, db, emails };
};
type Auth = ReturnType<typeof build>["auth"];

const signUp = (auth: Auth, callbackURL?: string) =>
  auth.handler(
    new Request(`${BASE}/sign-up/email`, {
      method: "POST",
      headers: clientHeaders(),
      body: JSON.stringify({
        email: "a@example.com",
        password: "testpassword123",
        name: "A",
        ...(callbackURL ? { callbackURL } : {}),
      }),
    })
  );

// The user opens the link from the email, a top-level navigation
const openLink = (auth: Auth, url: string) => auth.handler(new Request(url));

const redeem = (auth: Auth, token: string) =>
  auth.handler(
    new Request(`${BASE}/cross-domain/one-time-token/verify`, {
      method: "POST",
      headers: clientHeaders(),
      body: JSON.stringify({ token }),
    })
  );

describe("cross domain email verification", () => {
  it("hands the session created by autoSignInAfterVerification to siteUrl", async () => {
    const { auth, db, emails } = build(true);
    await signUp(auth, "/welcome");
    const res = await openLink(auth, emails[0]!);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${SITE}/welcome`);
    // Not tied to a browser, like the link itself and magic links
    const verified = await redeem(auth, location.searchParams.get("ott")!);
    expect(verified.status).toBe(200);
    const { user, session } = await verified.json();
    expect(user.emailVerified).toBe(true);
    expect(db.session.map((s) => s.token)).toContain(session.token);
  });

  it("only hands it to siteUrl, like a magic link", async () => {
    const { auth, emails } = build(true);
    await signUp(auth, `${ADMIN}/welcome`);
    const res = await openLink(auth, emails[0]!);
    expect(res.headers.get("location")).toBe(`${ADMIN}/welcome`);
  });

  it("creates no session without autoSignInAfterVerification, as Better Auth", async () => {
    const { auth, db, emails } = build(false);
    await signUp(auth);
    const sessions = db.session.length;
    const res = await openLink(auth, emails[0]!);
    expect(res.headers.get("location")).toBe(`${SITE}/`);
    expect(db.session).toHaveLength(sessions);
    expect(db.user[0]!.emailVerified).toBe(true);
  });

  it("hands the session created when confirming an email change to siteUrl", async () => {
    const { auth, db, emails } = build(false);
    const signedUp = await signUp(auth);
    db.user[0]!.emailVerified = true;
    const cookie = signedUp.headers
      .get("set-better-auth-cookie")!
      .split(";")[0]!;
    const changed = await auth.handler(
      new Request(`${BASE}/change-email`, {
        method: "POST",
        headers: clientHeaders(cookie),
        body: JSON.stringify({ newEmail: "b@example.com" }),
      })
    );
    expect(changed.status).toBe(200);
    // The link opens without the app's session, which lives in the app
    const res = await openLink(auth, emails[emails.length - 1]!);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin).toBe(SITE);
    const verified = await redeem(auth, location.searchParams.get("ott")!);
    expect((await verified.json()).user.email).toBe("b@example.com");
  });
});
