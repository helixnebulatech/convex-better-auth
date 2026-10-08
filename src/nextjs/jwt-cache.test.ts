import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Unsigned JWT with an unexpired `exp`, as the convex plugin stores it in the
// `better-auth.convex_jwt` cookie. getToken only decodes it.
const cookieJwt = (() => {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const exp = Math.floor(Date.now() / 1000) + 600;
  return `${encode({ alg: "none" })}.${encode({ sub: "user", exp })}.sig`;
})();

const isAuthError = (error: unknown) =>
  error instanceof Error && /auth/i.test(error.message);

const setup = () =>
  convexBetterAuthNextJs({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
    jwtCache: { enabled: true, isAuthError },
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
      [queryRef, {}, { token: cookieJwt }],
      [queryRef, {}, { token: "fresh-token" }],
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
