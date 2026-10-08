import { afterEach, describe, expect, it, vi } from "vitest";
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
