import { describe, expect, it, vi } from "vitest";
import { httpRouter } from "convex/server";
import { createClient } from "./create-client.js";
import type { TrustedOriginsOption } from "../utils/index.js";

const component = {
  adapter: {
    create: "create",
    findOne: "findOne",
    findMany: "findMany",
    updateOne: "updateOne",
    updateMany: "updateMany",
    deleteOne: "deleteOne",
    deleteMany: "deleteMany",
  },
} as any;

const getRouteHandler = (
  http: ReturnType<typeof httpRouter>,
  path: string,
  method: "GET" | "POST" | "OPTIONS"
) => {
  const route = http.lookup(path, method);
  if (!route) {
    return null;
  }
  return route[0] as unknown as {
    _handler: (ctx: unknown, request: Request) => Promise<Response>;
  };
};

describe("createClient route registration", () => {
  it("registerRoutes eagerly initializes auth and infers basePath", () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        basePath: "/custom/auth",
        trustedOrigins: ["https://app.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://app.example.com"],
        },
      }),
    }));

    client.registerRoutes(http, createAuth);

    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(getRouteHandler(http, "/custom/auth/test", "GET")).toBeTruthy();
    expect(
      getRouteHandler(http, "/.well-known/openid-configuration", "GET")
    ).toBeTruthy();
  });

  it("registerRoutes uses auth options for CORS and basePath", async () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        basePath: "/custom/auth",
        trustedOrigins: ["https://app.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://app.example.com"],
        },
      }),
    }));

    client.registerRoutes(http, createAuth, { cors: true });

    expect(createAuth).toHaveBeenCalledTimes(1);
    expect(getRouteHandler(http, "/custom/auth/test", "GET")).toBeTruthy();
    expect(getRouteHandler(http, "/custom/auth/test", "OPTIONS")).toBeTruthy();

    const optionsHandler = getRouteHandler(
      http,
      "/custom/auth/test",
      "OPTIONS"
    );
    expect(optionsHandler).toBeTruthy();
    const response = await optionsHandler!._handler(
      {},
      new Request("https://deployment.convex.site/custom/auth/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      })
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.example.com"
    );
    expect(createAuth).toHaveBeenCalledTimes(1);

    const getHandler = getRouteHandler(http, "/custom/auth/test", "GET");
    expect(getHandler).toBeTruthy();
    await getHandler!._handler(
      {},
      new Request("https://deployment.convex.site/custom/auth/test", {
        method: "GET",
      })
    );
    expect(createAuth).toHaveBeenCalledTimes(2);
  });

  describe("forwarded host restore", () => {
    const callHandler = async (
      trustedOrigins: TrustedOriginsOption,
      headers: Record<string, string>
    ) => {
      const client = createClient(component);
      const http = httpRouter();
      const handler = vi.fn(async (_request: Request) => new Response("ok"));
      const createAuth = vi.fn(() => ({
        handler,
        options: { trustedOrigins },
        $context: Promise.resolve({ options: { trustedOrigins } }),
      }));
      client.registerRoutes(http, createAuth);
      const getHandler = getRouteHandler(http, "/api/auth/test", "GET");
      expect(getHandler).toBeTruthy();
      await getHandler!._handler(
        {},
        new Request("https://deployment.convex.site/api/auth/test", {
          method: "GET",
          headers: { host: "deployment.convex.site", ...headers },
        })
      );
      const forwarded = handler.mock.calls[0]?.[0] as Request;
      expect(forwarded).toBeInstanceOf(Request);
      return forwarded.headers;
    };

    it("restores the original host when it is an exact trusted origin", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBe("app.example.com");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("ignores the original host when it only matches a wildcard", async () => {
      const headers = await callHandler(
        ["https://app.example.com", "https://*.previews.example.app"],
        {
          "x-forwarded-host": "deployment.convex.site",
          "x-forwarded-proto": "https",
          "x-better-auth-forwarded-host": "branch.previews.example.app",
          "x-better-auth-forwarded-proto": "https",
        }
      );
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    it("ignores a trusted original host without a valid protocol", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
      });
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    // Not an exact trusted origin: Better Auth falls back to Host and the
    // request URL, as without a trusted proxy
    it("drops incoming x-forwarded-* that aren't an exact trusted origin", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "proxy.example.com",
        "x-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    // Matching Host and the request URL, they lead Better Auth to the same
    // host and protocol as without them, so trustedOrigins isn't evaluated.
    // Convex's cloud edge sends these on every request.
    it("leaves x-forwarded-* matching Host and the request URL unchecked", async () => {
      const trustedOrigins = vi.fn(async () => ["https://app.example.com"]);
      const headers = await callHandler(trustedOrigins, {
        "x-forwarded-host": "Deployment.Convex.Site",
        "x-forwarded-proto": "https",
      });
      expect(trustedOrigins).not.toHaveBeenCalled();
      expect(headers.get("x-forwarded-host")).toBe("Deployment.Convex.Site");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    it("checks x-forwarded-* when the protocol differs from the request URL", async () => {
      const trustedOrigins = vi.fn(async () => ["https://app.example.com"]);
      const headers = await callHandler(trustedOrigins, {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "http",
      });
      expect(trustedOrigins).toHaveBeenCalled();
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    it("checks x-forwarded-* when the request came through the handlers", async () => {
      const trustedOrigins = vi.fn(async () => ["https://app.example.com"]);
      const headers = await callHandler(trustedOrigins, {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "https",
      });
      expect(trustedOrigins).toHaveBeenCalled();
      expect(headers.get("x-forwarded-host")).toBe("app.example.com");
    });

    it("keeps incoming x-forwarded-* that are an exact trusted origin", async () => {
      // e.g. Convex's edge host, when it's the baseURL Better Auth trusts
      const headers = await callHandler(["https://deployment.convex.site"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBe("deployment.convex.site");
      expect(headers.get("x-forwarded-proto")).toBe("https");
    });

    // A self-hosted backend passes a client's x-forwarded-* through
    it("drops x-forwarded-* a client sent for a wildcard origin", async () => {
      const headers = await callHandler(
        ["https://app.example.com", "https://*.vercel.app"],
        {
          "x-forwarded-host": "attacker.vercel.app",
          "x-forwarded-proto": "https",
        }
      );
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    it("honors exact origins returned by a trustedOrigins function", async () => {
      const headers = await callHandler(
        (request?: Request) =>
          request?.headers.get("x-test-tenant") === "acme"
            ? ["https://acme.example.com"]
            : [],
        {
          "x-test-tenant": "acme",
          "x-better-auth-forwarded-host": "acme.example.com",
          "x-better-auth-forwarded-proto": "https",
        }
      );
      expect(headers.get("x-forwarded-host")).toBe("acme.example.com");
    });

    it("ignores a trusted host with a different protocol", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-forwarded-host": "deployment.convex.site",
        "x-forwarded-proto": "https",
        "x-better-auth-forwarded-host": "app.example.com",
        "x-better-auth-forwarded-proto": "http",
      });
      expect(headers.get("x-forwarded-host")).toBeNull();
      expect(headers.get("x-forwarded-proto")).toBeNull();
    });

    it("restores http for an exact http origin", async () => {
      const headers = await callHandler(["http://localhost:3000"], {
        "x-better-auth-forwarded-host": "localhost:3000",
        "x-better-auth-forwarded-proto": "http",
      });
      expect(headers.get("x-forwarded-host")).toBe("localhost:3000");
      expect(headers.get("x-forwarded-proto")).toBe("http");
    });

    it("ignores an original host that carries more than a host", async () => {
      for (const host of [
        "app.example.com/evil",
        "user@app.example.com",
        "app.example.com:443",
      ]) {
        const headers = await callHandler(["https://app.example.com"], {
          "x-forwarded-host": "deployment.convex.site",
          "x-better-auth-forwarded-host": host,
          "x-better-auth-forwarded-proto": "https",
        });
        expect(headers.get("x-forwarded-host")).toBeNull();
      }
    });

    it("matches the original host without regard to case", async () => {
      const headers = await callHandler(["https://app.example.com"], {
        "x-better-auth-forwarded-host": "App.Example.com",
        "x-better-auth-forwarded-proto": "https",
      });
      expect(headers.get("x-forwarded-host")).toBe("App.Example.com");
    });
  });

  it("registerRoutesLazy resolves trustedOrigins lazily when needed", async () => {
    const client = createClient(component);
    const http = httpRouter();
    const createAuth = vi.fn(() => ({
      handler: async () => new Response("ok"),
      options: {
        trustedOrigins: ["https://fallback.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://fallback.example.com"],
        },
      }),
    }));

    client.registerRoutesLazy(http, createAuth, { cors: true });
    expect(createAuth).not.toHaveBeenCalled();
    expect(getRouteHandler(http, "/api/auth/test", "GET")).toBeTruthy();

    const optionsHandler = getRouteHandler(http, "/api/auth/test", "OPTIONS");
    expect(optionsHandler).toBeTruthy();
    const response = await optionsHandler!._handler(
      {},
      new Request("https://deployment.convex.site/api/auth/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://fallback.example.com",
          "access-control-request-method": "GET",
        },
      })
    );

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://fallback.example.com"
    );
    expect(createAuth).toHaveBeenCalledTimes(1);
  });
});

describe("createClient verbose logging", () => {
  const requestSecrets = {
    cookie: "better-auth.session_token=cookie-secret",
    authorization: "Bearer authorization-secret",
    "better-auth-cookie": "better-auth.session_token=cross-domain-secret",
    "x-api-key": "api-key-secret",
    referer: "https://app.example.com/reset-password?token=referer-secret",
  };
  const makeAuth = () => ({
    handler: async () => {
      const headers = new Headers({
        "set-better-auth-cookie": "set-better-auth-cookie-secret",
        "set-auth-token": "set-auth-token-secret",
        "set-auth-jwt": "set-auth-jwt-secret",
        location: "https://app.example.com/dashboard?ott=location-secret",
      });
      headers.append("set-cookie", "a=set-cookie-secret; Path=/");
      return new Response("ok", { headers });
    },
    options: { trustedOrigins: ["https://app.example.com"] },
    $context: Promise.resolve({
      options: { trustedOrigins: ["https://app.example.com"] },
    }),
  });

  it.each([
    ["registerRoutes", false],
    ["registerRoutes", true],
    ["registerRoutesLazy", false],
    ["registerRoutesLazy", true],
  ] as const)(
    "%s (cors: %s) redacts credentials in logged headers",
    async (register, cors) => {
      const client = createClient(component, { verbose: true });
      const http = httpRouter();
      client[register](http, makeAuth, { cors });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const response = await getRouteHandler(
          http,
          "/api/auth/get-session",
          "GET"
        )!._handler(
          {},
          new Request("https://example.convex.site/api/auth/get-session", {
            headers: { ...requestSecrets, origin: "https://app.example.com" },
          })
        );
        expect(response.status).toBe(200);
        // Headers serialize to {} in JSON, flatten them like a console would
        const logged = JSON.stringify(log.mock.calls, (_key, value) =>
          value instanceof Headers ? Array.from(value.entries()) : value
        );
        expect(logged).toContain("request headers");
        expect(logged).toContain("response headers");
        expect(logged).toContain("[redacted]");
        // Redirect targets stay visible, without their query string
        expect(logged).toContain(
          "https://app.example.com/dashboard?[redacted]"
        );
        expect(logged).toContain(
          "https://app.example.com/reset-password?[redacted]"
        );
        for (const secret of [
          "cookie-secret",
          "authorization-secret",
          "cross-domain-secret",
          "set-cookie-secret",
          "set-better-auth-cookie-secret",
          "set-auth-token-secret",
          "api-key-secret",
          "location-secret",
          "set-auth-jwt-secret",
          "referer-secret",
        ]) {
          expect(logged).not.toContain(secret);
        }
      } finally {
        log.mockRestore();
      }
    }
  );
});
