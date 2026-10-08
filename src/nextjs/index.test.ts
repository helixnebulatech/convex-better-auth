import { afterEach, describe, expect, it, vi } from "vitest";
import { convexBetterAuthNextJs } from "./index.js";

const convexNextJs = vi.hoisted(() => ({
  fetchAction: vi.fn(async () => "action"),
  fetchMutation: vi.fn(async () => "mutation"),
  fetchQuery: vi.fn(async () => "query"),
  preloadQuery: vi.fn(async () => "preloaded"),
}));
vi.mock("convex/nextjs", () => convexNextJs);
vi.mock("next/headers.js", () => ({
  headers: async () => new Headers({ cookie: "session=1" }),
}));

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";

const setup = () => {
  const { handler } = convexBetterAuthNextJs({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
  });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response());
  return { handler, fetchSpy };
};

const initOf = (spy: ReturnType<typeof vi.spyOn>): RequestInit =>
  (spy.mock.calls[0]?.[1] as RequestInit) ?? {};

const headersOf = (spy: ReturnType<typeof vi.spyOn>): Headers =>
  new Headers(initOf(spy).headers);

describe("convexBetterAuthNextJs handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips hop-by-hop headers from the forwarded request", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      {
        method: "POST",
        headers: {
          "transfer-encoding": "chunked",
          "content-length": "42",
          connection: "keep-alive",
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: "test@example.com" }),
      }
    );
    await handler.POST(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("transfer-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("connection")).toBeNull();
  });

  it("forwards to upstream URL preserving path and query", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email?foo=bar",
      { method: "POST", body: "{}" }
    );
    await handler.POST(request);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `${SITE_URL}/api/auth/sign-in/email?foo=bar`
    );
  });

  it("sets host and forwarding headers", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      { method: "POST", body: "{}" }
    );
    await handler.POST(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("host")).toBe(new URL(SITE_URL).host);
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-better-auth-forwarded-host")).toBe("app.example.com");
    expect(headers.get("x-better-auth-forwarded-proto")).toBe("https");
  });

  // get-convex/better-auth#422: Convex's edge routes on x-forwarded-host, so
  // an app domain there 404s before the component runs. The component
  // restores it from x-better-auth-forwarded-host instead.
  it("drops an inbound x-forwarded-host", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      {
        method: "POST",
        body: "{}",
        headers: {
          "x-forwarded-host": "proxy.internal.example.com",
          "x-better-auth-forwarded-host": "spoofed.example.com",
        },
      }
    );
    await handler.POST(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("x-forwarded-host")).toBeNull();
    expect(headers.get("x-better-auth-forwarded-host")).toBe("app.example.com");
  });

  it("buffers POST body and forwards as ArrayBuffer", async () => {
    const { handler, fetchSpy } = setup();
    const body = JSON.stringify({ email: "test@example.com" });
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      { method: "POST", body }
    );
    await handler.POST(request);
    const init = initOf(fetchSpy);
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
  });

  it("does not set body for GET requests", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/get-session",
      { method: "GET" }
    );
    await handler.GET(request);
    expect(initOf(fetchSpy).body).toBeUndefined();
  });

  it("strips hop-by-hop headers from the upstream response", async () => {
    const { handler, fetchSpy } = setup();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "set-cookie": "a=1; Path=/",
          connection: "keep-alive",
          "keep-alive": "timeout=5",
          "transfer-encoding": "chunked",
        },
      })
    );
    const response = await handler.GET(
      new Request("https://app.example.com/api/auth/ok")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBe("a=1; Path=/");
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("keep-alive")).toBeNull();
    expect(response.headers.get("transfer-encoding")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("does not set body for empty POST", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request("https://app.example.com/api/auth/sign-out", {
      method: "POST",
    });
    await handler.POST(request);
    expect(initOf(fetchSpy).body).toBeUndefined();
  });
});

describe("convexBetterAuthNextJs Convex helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  const mockTokenEndpoint = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ token: "jwt" }), {
          headers: { "content-type": "application/json" },
        })
    );

  // get-convex/better-auth#359: `convexUrl` was accepted but never passed on,
  // so convex/nextjs fell back to NEXT_PUBLIC_CONVEX_URL.
  it("passes convexUrl to the convex/nextjs helpers", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://other.convex.cloud");
    mockTokenEndpoint();
    const auth = convexBetterAuthNextJs({
      convexUrl: CONVEX_URL,
      convexSiteUrl: SITE_URL,
    });
    const fn = "users:get" as any;
    const args = { id: "1" };

    await auth.preloadAuthQuery(fn, args);
    await auth.fetchAuthQuery(fn, args);
    await auth.fetchAuthMutation(fn, args);
    await auth.fetchAuthAction(fn, args);

    const expected = [fn, args, { token: "jwt", url: CONVEX_URL }];
    expect(convexNextJs.preloadQuery).toHaveBeenCalledWith(...expected);
    expect(convexNextJs.fetchQuery).toHaveBeenCalledWith(...expected);
    expect(convexNextJs.fetchMutation).toHaveBeenCalledWith(...expected);
    expect(convexNextJs.fetchAction).toHaveBeenCalledWith(...expected);
  });

  it("omits url when convexUrl is not set so convex/nextjs uses its default", async () => {
    mockTokenEndpoint();
    const auth = convexBetterAuthNextJs({
      convexUrl: undefined as unknown as string,
      convexSiteUrl: SITE_URL,
    });

    await auth.fetchAuthQuery("users:get" as any, {});

    const options = (
      convexNextJs.fetchQuery.mock.calls[0] as unknown[] | undefined
    )?.[2];
    expect(options).toEqual({ token: "jwt" });
    expect(options).not.toHaveProperty("url");
  });
});
