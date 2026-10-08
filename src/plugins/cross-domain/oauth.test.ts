import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthClient } from "better-auth/client";
import { crossDomainClient } from "./client.js";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import type { MemoryDB } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import { crossDomain } from "./index.js";

const AUTH = "https://deploy.convex.site";
const BASE = `${AUTH}/api/auth`;
const SITE = "https://app.example.com";
const VERIFIER = "v".repeat(64);

// The authorization code picks the provider account that consented
const ACCOUNTS: Record<string, { id: string; email: string; name: string }> = {
  codeA: { id: "sub-a", email: "a@example.com", name: "User A" },
  codeB: { id: "sub-b", email: "b@example.com", name: "User B" },
};

const build = (
  opts: { crossDomain?: boolean; trustedOrigins?: string[] } = {}
) => {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const magicLinks: string[] = [];
  const auth = betterAuth({
    baseURL: AUTH,
    secret: "cross-domain-test-secret-at-least-32-characters",
    database: memoryAdapter(db),
    trustedOrigins: opts.trustedOrigins ?? [SITE],
    logger: { disabled: true },
    // Lets the link tests link an account with another email
    account: { accountLinking: { allowDifferentEmails: true } },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "mock",
            clientId: "c",
            clientSecret: "s",
            authorizationUrl: "https://provider.example.com/authorize",
            getToken: async ({ code }: { code: string }) =>
              ({ accessToken: `at:${code}` }) as any,
            getUserInfo: async (tokens: any) =>
              ({
                ...ACCOUNTS[String(tokens.accessToken).slice(3)],
                emailVerified: true,
              }) as any,
          },
        ],
      }),
      magicLink({
        sendMagicLink: async ({ url }) => {
          magicLinks.push(url);
        },
      }),
      ...(opts.crossDomain === false ? [] : [crossDomain({ siteUrl: SITE })]),
    ],
  });
  return { auth, db, magicLinks };
};
// The helpers only need the request handler
type Auth = { handler: (request: Request) => Promise<Response> };

// Like crossDomainClient: cookies travel in the Better-Auth-Cookie header
const clientHeaders = (cookie = "") => ({
  "content-type": "application/json",
  origin: SITE,
  "better-auth-cookie": cookie,
});

const signInSocial = async (
  auth: Auth,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = clientHeaders()
) => {
  const res = await auth.handler(
    new Request(`${BASE}/sign-in/social`, {
      method: "POST",
      headers,
      body: JSON.stringify({ provider: "mock", callbackURL: SITE, ...body }),
    })
  );
  const { url } = await res.json();
  return new URL(url).searchParams.get("state")!;
};

// The form POST crossDomainClient submits from the app
const startOAuth = (
  auth: Auth,
  state: string,
  { origin = SITE, verifier = VERIFIER } = {}
) =>
  auth.handler(
    new Request(`${BASE}/cross-domain/oauth/start`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...(origin ? { origin } : {}),
      },
      body: new URLSearchParams({ state, verifier }).toString(),
    })
  );

const callback = (auth: Auth, state: string, code: string, cookie = "") =>
  auth.handler(
    new Request(`${BASE}/callback/mock?code=${code}&state=${state}`, {
      headers: cookie ? { cookie } : {},
    })
  );

const redeem = (auth: Auth, token: string, verifier?: string) =>
  auth.handler(
    new Request(`${BASE}/cross-domain/one-time-token/verify`, {
      method: "POST",
      headers: clientHeaders(),
      body: JSON.stringify({ token, ...(verifier ? { verifier } : {}) }),
    })
  );

const cookieHeader = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

// Signs in through the full browser flow and returns the callback response
const browserSignIn = async (auth: Auth, code: string, body = {}) => {
  const state = await signInSocial(auth, body);
  const start = await startOAuth(auth, state);
  expect(start.status).toBe(302);
  expect(new URL(start.headers.get("location")!).origin).toBe(
    "https://provider.example.com"
  );
  return callback(auth, state, code, cookieHeader(start));
};

const ottOf = (res: Response) =>
  new URL(res.headers.get("location")!).searchParams.get("ott");

describe("cross domain OAuth", () => {
  it("rejects a callback without the state cookie, like Better Auth", async () => {
    for (const crossDomainEnabled of [false, true]) {
      const { auth, db } = build({ crossDomain: crossDomainEnabled });
      const state = await signInSocial(auth);
      const res = await callback(auth, state, "codeA");
      expect(res.headers.get("location")).toContain("state_mismatch");
      expect(db.session).toHaveLength(0);
    }
  });

  it("signs in through the browser and hands the session to the app", async () => {
    const { auth } = build();
    const res = await browserSignIn(auth, "codeA");
    expect(new URL(res.headers.get("location")!).origin).toBe(SITE);
    const ott = ottOf(res)!;
    const verified = await redeem(auth, ott, VERIFIER);
    expect(verified.status).toBe(200);
    expect((await verified.json()).user.email).toBe("a@example.com");
  });

  it("only redeems an OAuth one-time token with the verifier of the browser that started the flow", async () => {
    const { auth } = build();
    const ott = ottOf(await browserSignIn(auth, "codeA"))!;
    expect((await redeem(auth, ott)).status).toBe(400);
    expect((await redeem(auth, ott, "w".repeat(64))).status).toBe(400);
    // Failed attempts don't consume it
    expect((await redeem(auth, ott, VERIFIER)).status).toBe(200);
  });

  it("only starts a flow from the app's origin and for a pending state", async () => {
    const { auth } = build();
    const state = await signInSocial(auth);
    expect((await startOAuth(auth, state, { origin: "" })).status).toBe(403);
    // A null Origin (strict referrer policy) is rejected like Better Auth
    // does, on its error page since the browser navigated here
    const nullOrigin = await startOAuth(auth, state, { origin: "null" });
    expect(nullOrigin.status).toBe(302);
    expect(nullOrigin.headers.get("location")).toBe(
      `${BASE}/error?error=missing_or_null_origin`
    );
    expect(nullOrigin.headers.getSetCookie()).toEqual([]);
    // Or to the app's errorCallbackURL, as Better Auth does for OAuth errors
    const withErrorURL = await signInSocial(auth, {
      errorCallbackURL: "/auth-error",
    });
    expect(
      (await startOAuth(auth, withErrorURL, { origin: "null" })).headers.get(
        "location"
      )
    ).toBe(`${SITE}/auth-error?error=missing_or_null_origin`);
    expect(
      (await startOAuth(auth, state, { origin: "https://evil.example.com" }))
        .status
    ).toBe(403);
    expect((await startOAuth(auth, "unknown-state")).status).toBe(400);
    expect((await startOAuth(auth, state)).status).toBe(302);
    // A state can only be started once
    expect((await startOAuth(auth, state)).status).toBe(400);
  });

  it("doesn't hand the session to origins other than siteUrl", async () => {
    const { auth, db } = build({
      trustedOrigins: [SITE, "your-scheme://", "https://*.vercel.app"],
    });
    for (const callbackURL of [
      "your-scheme://x",
      "https://attacker.vercel.app/x",
    ]) {
      const res = await browserSignIn(auth, "codeB", { callbackURL });
      expect(res.headers.get("location")).toContain(
        new URL(callbackURL).protocol
      );
      expect(res.headers.get("location")).not.toContain("ott=");
    }
    expect(
      db.verification.some((v) => v.identifier.startsWith("one-time-token:"))
    ).toBe(false);
  });

  it("hands the session to a relative callbackURL on siteUrl", async () => {
    const { auth } = build();
    const res = await browserSignIn(auth, "codeA", {
      callbackURL: "/dashboard",
    });
    const location = new URL(res.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${SITE}/dashboard`);
    expect(location.searchParams.get("ott")).toBeTruthy();
  });

  it("links an account only from the browser that started the flow", async () => {
    const { auth, db } = build();
    const ott = ottOf(await browserSignIn(auth, "codeA"))!;
    const signedIn = await redeem(auth, ott, VERIFIER);
    const sessionCookie = signedIn.headers.get("set-better-auth-cookie")!;
    const cookie = sessionCookie.split(";")[0];
    const linkState = async () => {
      const res = await auth.handler(
        new Request(`${BASE}/link-social`, {
          method: "POST",
          headers: clientHeaders(cookie),
          body: JSON.stringify({ provider: "mock", callbackURL: SITE }),
        })
      );
      return new URL((await res.json()).url).searchParams.get("state")!;
    };

    const forwarded = await callback(auth, await linkState(), "codeB");
    expect(forwarded.headers.get("location")).toContain("state_mismatch");
    expect(db.account).toHaveLength(1);

    const state = await linkState();
    const start = await startOAuth(auth, state);
    await callback(auth, state, "codeB", cookieHeader(start));
    expect(db.account).toHaveLength(2);
  });

  it("doesn't hand off a session from a flow not started through the auth server", async () => {
    const { auth, db } = build();
    // The attacker completes their own flow with the state cookie from the
    // sign-in response, skipping /cross-domain/oauth/start
    const res = await auth.handler(
      new Request(`${BASE}/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "mock", callbackURL: SITE }),
      })
    );
    const state = new URL((await res.json()).url).searchParams.get("state")!;
    const cb = await callback(auth, state, "codeA", cookieHeader(res));
    expect(db.session).toHaveLength(1);
    expect(cb.headers.get("location")).not.toContain("ott=");
  });

  it("keeps the app's skipStateCookieCheck option, as Better Auth does", async () => {
    const db: MemoryDB = {
      user: [],
      session: [],
      account: [],
      verification: [],
    };
    const auth = betterAuth({
      baseURL: AUTH,
      secret: "cross-domain-test-secret-at-least-32-characters",
      database: memoryAdapter(db),
      trustedOrigins: [SITE],
      logger: { disabled: true },
      account: { skipStateCookieCheck: true },
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: "mock",
              clientId: "c",
              clientSecret: "s",
              authorizationUrl: "https://provider.example.com/authorize",
              getToken: async () => ({ accessToken: "at:codeA" }) as any,
              getUserInfo: async () =>
                ({ ...ACCOUNTS.codeA, emailVerified: true }) as any,
            },
          ],
        }),
        crossDomain({ siteUrl: SITE }),
      ],
    });
    const state = await signInSocial(auth);
    const res = await callback(auth, state, "codeA");
    expect(res.headers.get("location")).not.toContain("state_mismatch");
    expect(db.session).toHaveLength(1);
  });

  it("keeps magic link tokens usable from any browser, like Better Auth's magic link", async () => {
    const { auth, magicLinks } = build();
    await auth.handler(
      new Request(`${BASE}/sign-in/magic-link`, {
        method: "POST",
        headers: clientHeaders(),
        body: JSON.stringify({ email: "m@example.com", callbackURL: SITE }),
      })
    );
    const res = await auth.handler(new Request(magicLinks[0]!));
    const ott = ottOf(res)!;
    const verified = await redeem(auth, ott);
    expect(verified.status).toBe(200);
    expect((await verified.json()).user.email).toBe("m@example.com");
  });
});

// A crossDomainClient talking to the test server, with a minimal DOM that
// records the form it submits and the referrer policy in effect at the time
const setupClient = (
  auth: Auth,
  options: { setReferrerPolicy?: boolean } = {}
) => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
  const client = createAuthClient({
    baseURL: BASE,
    plugins: [crossDomainClient({ storage, ...options })],
    fetchOptions: {
      customFetchImpl: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("origin", SITE);
        return auth.handler(new Request(input, { ...init, headers }));
      },
    },
  });
  const submitted: {
    action: string;
    fields: Record<string, string>;
    referrerPolicy?: string;
  }[] = [];
  // The app's own policy set with a meta tag, eg. helmet's default
  let referrerPolicy = "no-referrer";
  const createElement = (tag: string) => {
    const element: any = { tag, children: [] as any[], style: {} };
    element.appendChild = (child: any) => element.children.push(child);
    element.submit = () =>
      submitted.push({
        action: element.action,
        fields: Object.fromEntries(
          element.children.map((input: any) => [input.name, input.value])
        ),
        referrerPolicy,
      });
    return element;
  };
  const document = {
    createElement,
    querySelector: (selector: string) =>
      selector === 'meta[name="referrer"]'
        ? { getAttribute: () => referrerPolicy }
        : null,
    body: { appendChild() {} },
    head: {
      appendChild(element: any) {
        if (element.tag === "meta" && element.name === "referrer") {
          referrerPolicy = element.content;
        }
      },
    },
  };
  // Follows the form POST, the provider and the callback like the browser
  const completeFlow = async (form: (typeof submitted)[0], code = "codeA") => {
    const start = await startOAuth(auth, form.fields.state!, {
      verifier: form.fields.verifier!,
    });
    return callback(auth, form.fields.state!, code, cookieHeader(start));
  };
  return { client, submitted, document, completeFlow };
};

describe("crossDomainClient OAuth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts OAuth through the auth server and redeems the token with its verifier", async () => {
    const { auth } = build();
    const { client, submitted, document, completeFlow } = setupClient(auth);
    vi.stubGlobal("document", document);
    const { data } = await client.$fetch<{ url: string; redirect: boolean }>(
      "/sign-in/social",
      { method: "POST", body: { provider: "mock", callbackURL: SITE } }
    );
    // Better Auth's redirect plugin doesn't navigate to the provider
    expect(data?.redirect).toBe(false);
    expect(submitted).toHaveLength(1);
    // The redirect already started, so the URL can't be started again
    await expect(
      (client as any).startOAuthRedirect(data!.url)
    ).rejects.toThrow();
    expect(submitted).toHaveLength(1);
    const [form] = submitted as [(typeof submitted)[0]];
    expect(form.action).toBe(`${BASE}/cross-domain/oauth/start`);
    // The app's policy is left alone by default
    expect(form.referrerPolicy).toBe("no-referrer");

    const ott = ottOf(await completeFlow(form))!;
    // Another browser (no stored verifier) can't redeem it
    expect((await redeem(auth, ott)).status).toBe(400);
    const { data: verified, error } = await (
      client as any
    ).crossDomain.oneTimeToken.verify({ token: ott });
    expect(error).toBeNull();
    expect(verified.user.email).toBe("a@example.com");
  });

  it("only changes the page's referrer policy when the app opts in", async () => {
    const { auth } = build();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const setReferrerPolicy of [false, true]) {
        const { client, submitted, document } = setupClient(auth, {
          setReferrerPolicy,
        });
        vi.stubGlobal("document", document);
        await client.$fetch("/sign-in/social", {
          method: "POST",
          body: { provider: "mock", callbackURL: SITE },
        });
        // Under no-referrer browsers send `Origin: null`, opting in sends the
        // app's origin
        expect(submitted[0]!.referrerPolicy).toBe(
          setReferrerPolicy ? "strict-origin-when-cross-origin" : "no-referrer"
        );
      }
      // Without the option, the developer is told why sign-in will fail
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain("setReferrerPolicy");
    } finally {
      warn.mockRestore();
    }
  });

  it("starts the redirect with startOAuthRedirect after disableRedirect, as Better Auth allows", async () => {
    const { auth } = build();
    const { client, submitted, document, completeFlow } = setupClient(auth);
    vi.stubGlobal("document", document);
    const { data } = await client.$fetch<{ url: string; redirect: boolean }>(
      "/sign-in/social",
      {
        method: "POST",
        body: { provider: "mock", callbackURL: SITE, disableRedirect: true },
      }
    );
    expect(data?.redirect).toBe(false);
    expect(submitted).toHaveLength(0);
    await expect(
      (client as any).startOAuthRedirect("https://provider.example.com/other")
    ).rejects.toThrow();
    await (client as any).startOAuthRedirect(data!.url);
    expect(submitted).toHaveLength(1);
    // A second call (eg. a double click) doesn't start the used state again
    await expect(
      (client as any).startOAuthRedirect(data!.url)
    ).rejects.toThrow();
    expect(submitted).toHaveLength(1);
    const ott = ottOf(await completeFlow(submitted[0]!))!;
    const { error } = await (client as any).crossDomain.oneTimeToken.verify({
      token: ott,
    });
    expect(error).toBeNull();
  });
});
