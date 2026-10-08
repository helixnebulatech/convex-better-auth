import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as jose from "jose";
import type { FunctionReference } from "convex/server";
import { convexBetterAuthNextJs } from "./index.js";

const { mockFetchQuery, mockFetchMutation, requestHeaders } = vi.hoisted(
  () => ({
    mockFetchQuery: vi.fn(),
    mockFetchMutation: vi.fn(),
    requestHeaders: { current: new Headers() },
  })
);

vi.mock("convex/nextjs", () => ({
  fetchQuery: mockFetchQuery,
  fetchMutation: mockFetchMutation,
  fetchAction: vi.fn(),
  preloadQuery: vi.fn(),
}));

vi.mock("next/headers.js", () => ({
  headers: async () => requestHeaders.current,
}));

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";
const queryRef = "tasks:list" as unknown as FunctionReference<"query">;
const mutationRef = "tasks:add" as unknown as FunctionReference<"mutation">;

// Signed JWT with an unexpired `exp`, as the convex plugin stores it in the
// `better-auth.convex_jwt` cookie. getToken verifies it against `jwks`.
const { privateKey, publicKey } = await jose.generateKeyPair("RS256");
const jwks = JSON.stringify([
  {
    id: "test-key",
    alg: "RS256",
    publicKey: JSON.stringify(await jose.exportJWK(publicKey)),
    privateKey: "",
    createdAt: 0,
  },
]);
const cookieJwt = await new jose.SignJWT({ sub: "user" })
  .setProtectedHeader({ alg: "RS256", kid: "test-key" })
  .setIssuer(SITE_URL)
  .setAudience("convex")
  .setExpirationTime("10m")
  .sign(privateKey);

const isAuthError = (error: unknown) =>
  error instanceof Error && /auth/i.test(error.message);

const setup = () =>
  convexBetterAuthNextJs({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
    jwtCache: { enabled: true, isAuthError, jwks },
  });

describe("convexBetterAuthNextJs jwtCache retry", () => {
  let tokenFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    requestHeaders.current = new Headers({
      cookie: `better-auth.convex_jwt=${cookieJwt}`,
    });
    tokenFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ token: "fresh-token" }), {
          headers: { "content-type": "application/json" },
        })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockFetchQuery.mockReset();
    mockFetchMutation.mockReset();
  });

  it("refetches the token and retries once when Convex rejects the cookie JWT", async () => {
    mockFetchQuery
      .mockRejectedValueOnce(new Error("Unauthenticated: token expired"))
      .mockResolvedValueOnce(["ok"]);

    await expect(setup().fetchAuthQuery(queryRef, {})).resolves.toEqual(["ok"]);

    expect(mockFetchQuery.mock.calls).toEqual([
      [queryRef, {}, { token: cookieJwt, url: CONVEX_URL }],
      [queryRef, {}, { token: "fresh-token", url: CONVEX_URL }],
    ]);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
    expect(String(tokenFetch.mock.calls[0]?.[0])).toBe(
      `${SITE_URL}/api/auth/convex/token`
    );
  });

  it("does not retry a mutation that failed with a non-auth error", async () => {
    const failure = new Error("Validation failed");
    mockFetchMutation.mockRejectedValue(failure);

    await expect(setup().fetchAuthMutation(mutationRef, {})).rejects.toBe(
      failure
    );

    expect(mockFetchMutation).toHaveBeenCalledTimes(1);
    expect(tokenFetch).not.toHaveBeenCalled();
  });

  it("does not retry when the token was just fetched", async () => {
    requestHeaders.current = new Headers();
    const failure = new Error("Unauthenticated");
    mockFetchQuery.mockRejectedValue(failure);

    await expect(setup().fetchAuthQuery(queryRef, {})).rejects.toBe(failure);

    expect(mockFetchQuery).toHaveBeenCalledTimes(1);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });
});

describe("convexBetterAuthNextJs isAuthenticated with jwtCache", () => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  let tokenFetch: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The token endpoint answers like Better Auth without a session
    tokenFetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify(null), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const withCookie = (jwt: string) => {
    requestHeaders.current = new Headers({
      cookie: `better-auth.convex_jwt=${jwt}`,
    });
  };

  it("is false for an unsigned cookie JWT", async () => {
    withCookie(
      `${encode({ alg: "none" })}.${encode({
        sub: "user",
        iss: SITE_URL,
        aud: "convex",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })}.`
    );
    expect(await setup().isAuthenticated()).toBe(false);
    expect(tokenFetch).toHaveBeenCalledTimes(1);
  });

  it("is false for a cookie JWT signed with another key", async () => {
    const other = await jose.generateKeyPair("RS256");
    withCookie(
      await new jose.SignJWT({ sub: "user" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(SITE_URL)
        .setAudience("convex")
        .setExpirationTime("10m")
        .sign(other.privateKey)
    );
    expect(await setup().isAuthenticated()).toBe(false);
  });

  it("is false for a signed cookie JWT with another audience", async () => {
    withCookie(
      await new jose.SignJWT({ sub: "user" })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(SITE_URL)
        .setAudience("other")
        .setExpirationTime("10m")
        .sign(privateKey)
    );
    expect(await setup().isAuthenticated()).toBe(false);
  });

  it("is true for a signed cookie JWT, without a token request", async () => {
    withCookie(cookieJwt);
    expect(await setup().isAuthenticated()).toBe(true);
    expect(tokenFetch).not.toHaveBeenCalled();
  });
});
