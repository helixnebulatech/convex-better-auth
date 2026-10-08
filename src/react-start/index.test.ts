// @vitest-environment node
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convexBetterAuthReactStart } from "./index.js";

const SITE_URL = "https://test.convex.site";
const CONVEX_URL = "https://test.convex.cloud";

const setup = () => {
  const { handler } = convexBetterAuthReactStart({
    convexUrl: CONVEX_URL,
    convexSiteUrl: SITE_URL,
  });
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response());
  return { handler, fetchSpy };
};

const initOf = (
  spy: ReturnType<typeof vi.spyOn>
): RequestInit & { duplex?: string } =>
  (spy.mock.calls[0]?.[1] as RequestInit & { duplex?: string }) ?? {};

const headersOf = (spy: ReturnType<typeof vi.spyOn>): Headers =>
  new Headers(initOf(spy).headers);

describe("convexBetterAuthReactStart handler", () => {
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
    await handler(request);
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
    await handler(request);
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
    await handler(request);
    const headers = headersOf(fetchSpy);
    expect(headers.get("host")).toBe(new URL(SITE_URL).host);
    expect(headers.get("x-forwarded-host")).toBe("app.example.com");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-better-auth-forwarded-host")).toBe("app.example.com");
    expect(headers.get("x-better-auth-forwarded-proto")).toBe("https");
  });

  it("streams the request body with duplex: half", async () => {
    const { handler, fetchSpy } = setup();
    const request = new Request(
      "https://app.example.com/api/auth/sign-in/email",
      { method: "POST", body: JSON.stringify({ email: "test@example.com" }) }
    );
    await handler(request);
    const init = initOf(fetchSpy);
    expect(init.duplex).toBe("half");
    expect(init.body).toBeDefined();
  });

  it("strips hop-by-hop headers from the upstream response", async () => {
    const { handler, fetchSpy } = setup();
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "a=1; Path=/",
          connection: "keep-alive, x-hop",
          "keep-alive": "timeout=5",
          "transfer-encoding": "chunked",
          "proxy-connection": "keep-alive",
          "x-hop": "1",
        },
      })
    );
    const response = await handler(
      new Request("https://app.example.com/api/auth/ok")
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("set-cookie")).toBe("a=1; Path=/");
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("keep-alive")).toBeNull();
    expect(response.headers.get("transfer-encoding")).toBeNull();
    expect(response.headers.get("proxy-connection")).toBeNull();
    expect(response.headers.get("x-hop")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("preserves redirect status and location from the upstream response", async () => {
    const { handler, fetchSpy } = setup();
    fetchSpy.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://accounts.example.com/authorize" },
      })
    );
    const response = await handler(
      new Request("https://app.example.com/api/auth/sign-in/social")
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://accounts.example.com/authorize"
    );
  });
});

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as AddressInfo).port)
    )
  );

describe("convexBetterAuthReactStart handler over real Node HTTP servers", () => {
  const servers: http.Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          })
      )
    );
  });

  // Regression for get-convex/better-auth#414: the upstream `connection:
  // keep-alive` response header was re-emitted to the client, so the app
  // server ignored the client's `Connection: close`, kept the socket open, and
  // answered the next request written to it with an empty 400.
  it("honours an inbound Connection: close", async () => {
    // Stand-in for the Convex site; Node adds `connection: keep-alive` and
    // `keep-alive: timeout=5` to its responses by default.
    const upstream = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true }));
      });
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);
    const { handler } = convexBetterAuthReactStart({
      convexUrl: CONVEX_URL,
      convexSiteUrl: `http://127.0.0.1:${upstreamPort}`,
    });

    // Minimal web-to-Node bridge, doing what srvx (TanStack Start / Nitro)
    // and Next.js do: copy every response header, then pipe the body.
    const app = http.createServer(async (req, res) => {
      const response = await handler(
        new Request(`http://${req.headers.host}${req.url}`, {
          method: req.method,
          headers: req.headers as Record<string, string>,
        })
      );
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    servers.push(app);
    const appPort = await listen(app);

    const result = await new Promise<{ raw: string; closedByServer: boolean }>(
      (resolve) => {
        const socket = net.connect(appPort, "127.0.0.1");
        let raw = "";
        const timer = setTimeout(() => {
          socket.destroy();
          resolve({ raw, closedByServer: false });
        }, 1000);
        socket.on("data", (chunk) => (raw += chunk));
        socket.on("end", () => {
          clearTimeout(timer);
          resolve({ raw, closedByServer: true });
        });
        socket.write(
          "GET /api/auth/ok HTTP/1.1\r\nHost: app.localhost\r\nConnection: close\r\n\r\n"
        );
      }
    );

    expect(result.raw).toMatch(/^HTTP\/1\.1 200/);
    expect(result.raw).toContain('{"ok":true}');
    expect(result.raw.toLowerCase()).not.toContain("connection: keep-alive");
    expect(result.closedByServer).toBe(true);
  });
});
