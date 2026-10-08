import { describe, expect, it, vi } from "vitest";
import { httpRouter } from "convex/server";
import { createClient } from "./create-client.js";

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

  it("restores preserved forwarded host headers before calling auth.handler", async () => {
    const client = createClient(component);
    const http = httpRouter();
    const handler = vi.fn(async (_request: Request) => new Response("ok"));
    const createAuth = vi.fn(() => ({
      handler,
      options: {
        trustedOrigins: ["https://app.example.com"],
      },
      $context: Promise.resolve({
        options: {
          trustedOrigins: ["https://app.example.com"],
        },
      }),
    }));

    client.registerRoutes(http, createAuth);

    const getHandler = getRouteHandler(http, "/api/auth/test", "GET");
    expect(getHandler).toBeTruthy();
    await getHandler!._handler(
      {},
      new Request("https://adjective-animal-123.convex.site/api/auth/test", {
        method: "GET",
        headers: {
          host: "deployment.convex.site",
          "x-forwarded-host": "deployment.convex.site",
          "x-forwarded-proto": "https",
          "x-better-auth-forwarded-host": "app.example.com",
          "x-better-auth-forwarded-proto": "https",
        },
      })
    );

    const forwardedRequest = handler.mock.calls[0]?.[0];
    expect(forwardedRequest).toBeInstanceOf(Request);
    expect(forwardedRequest.headers.get("x-forwarded-host")).toBe(
      "app.example.com"
    );
    expect(forwardedRequest.headers.get("x-forwarded-proto")).toBe("https");
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
        ]) {
          expect(logged).not.toContain(secret);
        }
      } finally {
        log.mockRestore();
      }
    }
  );
});
