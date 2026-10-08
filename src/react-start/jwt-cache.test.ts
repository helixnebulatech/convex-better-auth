import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { convexBetterAuthReactStart } from "./index.js";

const { requestHeaders } = vi.hoisted(() => ({
  requestHeaders: { current: new Headers() },
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequestHeaders: () => requestHeaders.current,
}));

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";
const queryRef = makeFunctionReference<"query">("tasks:list");
const mutationRef = makeFunctionReference<"mutation">("tasks:add");

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
  convexBetterAuthReactStart({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
    jwtCache: { enabled: true, isAuthError },
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Routes fetch calls made by getToken (token endpoint) and ConvexHttpClient
// (function calls). `convex` decides the response for each function call.
const mockFetch = (convex: (authorization: string | null) => Response) => {
  const functionCalls: (string | null)[] = [];
  const tokenCalls: string[] = [];
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith(SITE_URL)) {
        tokenCalls.push(url);
        return json({ token: "fresh-token" });
      }
      const authorization = new Headers(init?.headers).get("authorization");
      functionCalls.push(authorization);
      return convex(authorization);
    });
  return { spy, functionCalls, tokenCalls };
};

describe("convexBetterAuthReactStart jwtCache retry", () => {
  beforeEach(() => {
    requestHeaders.current = new Headers({
      cookie: `better-auth.convex_jwt=${cookieJwt}`,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refetches the token and retries once when Convex rejects the cookie JWT", async () => {
    const { functionCalls, tokenCalls } = mockFetch((authorization) =>
      authorization === `Bearer ${cookieJwt}`
        ? new Response('{"code":"Unauthenticated","message":"Token expired"}', {
            status: 401,
          })
        : json({ status: "success", value: ["ok"], logLines: [] })
    );

    await expect(setup().fetchAuthQuery(queryRef, {})).resolves.toEqual(["ok"]);

    expect(functionCalls).toEqual([
      `Bearer ${cookieJwt}`,
      "Bearer fresh-token",
    ]);
    expect(tokenCalls).toEqual([`${SITE_URL}/api/auth/convex/token`]);
  });

  it("does not retry a mutation that failed with a non-auth error", async () => {
    const { functionCalls, tokenCalls } = mockFetch(() =>
      json(
        { status: "error", errorMessage: "Validation failed", logLines: [] },
        560
      )
    );

    await expect(setup().fetchAuthMutation(mutationRef, {})).rejects.toThrow(
      "Validation failed"
    );

    expect(functionCalls).toHaveLength(1);
    expect(tokenCalls).toHaveLength(0);
  });

  it("does not retry when the token was just fetched", async () => {
    requestHeaders.current = new Headers();
    const { functionCalls, tokenCalls } = mockFetch(
      () =>
        new Response('{"code":"Unauthenticated","message":"Bad token"}', {
          status: 401,
        })
    );

    await expect(setup().fetchAuthQuery(queryRef, {})).rejects.toThrow(
      "Unauthenticated"
    );

    expect(functionCalls).toEqual(["Bearer fresh-token"]);
    expect(tokenCalls).toHaveLength(1);
  });
});
