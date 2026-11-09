import {
  httpActionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import type {
  DataModelFromSchemaDefinition,
  FunctionReference,
  GenericDataModel,
  GenericMutationCtx,
  GenericSchema,
  HttpRouter,
  SchemaDefinition,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Infer } from "convex/values";
import { getAuthTables, parseUserOutput } from "better-auth/db";
import type { BetterAuthOptions } from "better-auth/minimal";
import { convexAdapter } from "./adapter.js";
import type { DBAdapterDebugLogOption } from "better-auth/adapters";
import { corsRouter } from "convex-helpers/server/cors";
import type defaultSchema from "../component/schema.js";
import type { CreateAuth, GenericCtx } from "./index.js";
import type { TrustedOriginsOption } from "../utils/index.js";

export type AuthFunctions = {
  onCreate?: FunctionReference<"mutation", "internal", Record<string, any>>;
  onUpdate?: FunctionReference<"mutation", "internal", Record<string, any>>;
  onDelete?: FunctionReference<"mutation", "internal", Record<string, any>>;
};

export type Triggers<
  DataModel extends GenericDataModel,
  Schema extends SchemaDefinition<any, any>,
> = {
  [K in keyof Schema["tables"]]?: {
    onCreate?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      doc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
    onUpdate?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      newDoc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      },
      oldDoc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
    onDelete?: <Ctx extends GenericMutationCtx<DataModel>>(
      ctx: Ctx,
      doc: Infer<Schema["tables"][K]["validator"]> & {
        _id: string;
        _creationTime: number;
      }
    ) => Promise<void>;
  };
};

type SlimComponentApi = {
  adapter: {
    create: FunctionReference<"mutation", "internal">;
    findOne: FunctionReference<"query", "internal">;
    findMany: FunctionReference<"query", "internal">;
    updateOne: FunctionReference<"mutation", "internal">;
    updateMany: FunctionReference<"mutation", "internal">;
    deleteOne: FunctionReference<"mutation", "internal">;
    deleteMany: FunctionReference<"mutation", "internal">;
    // Optional so Local Installs that don't export them yet keep working,
    // see convexAdapter
    consumeOne?: FunctionReference<"mutation", "internal">;
    incrementOne?: FunctionReference<"mutation", "internal">;
  };
};

type RouteCorsOptions =
  | boolean
  | {
      allowedOrigins?: string[];
      allowedHeaders?: string[];
      exposedHeaders?: string[];
    };

type RegisterRoutesLazyOptions = {
  basePath?: string;
  trustedOrigins?: TrustedOriginsOption;
  cors?: RouteCorsOptions;
};

// Verbose logs end up in the Convex dashboard and log streams, keep
// credentials (session cookies, bearer tokens, JWTs) out of them
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "better-auth-cookie",
  "set-better-auth-cookie",
  "set-auth-token",
  "set-auth-jwt",
  "x-api-key",
]);
// Redirects carry one-time tokens, OAuth codes and state in the query
// string, and so can the page that sent a request (referer), e.g. a reset
// password page with ?token=
const redactLocation = (value: string) => {
  const queryStart = value.indexOf("?");
  return queryStart === -1 ? value : `${value.slice(0, queryStart)}?[redacted]`;
};
const redactHeaders = (headers: Headers) =>
  Array.from(headers.entries()).map(([name, value]) => [
    name,
    SENSITIVE_HEADERS.has(name.toLowerCase())
      ? "[redacted]"
      : name.toLowerCase() === "location" || name.toLowerCase() === "referer"
        ? redactLocation(value)
        : value,
  ]);

// Normalized `scheme://host` of an http(s) URL, or null
const parseHttpOrigin = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

// Origins named exactly in trustedOrigins, BETTER_AUTH_TRUSTED_ORIGINS and,
// with a dynamic baseURL, allowedHosts. Wildcard patterns and non-http(s)
// entries are left out.
const exactTrustedOrigins = async (
  auth: {
    $context: Promise<{
      trustedOrigins?: string[];
      options: { trustedOrigins?: unknown };
    }>;
  },
  request: Request
) => {
  const ctx = await auth.$context;
  const origins: unknown[] = [...(ctx.trustedOrigins ?? [])];
  if (Array.isArray(ctx.options.trustedOrigins)) {
    origins.push(...ctx.options.trustedOrigins);
  } else if (typeof ctx.options.trustedOrigins === "function") {
    const resolved = await ctx.options.trustedOrigins(request);
    if (Array.isArray(resolved)) {
      origins.push(...resolved);
    }
  }
  const result = new Set<string>();
  for (const origin of origins) {
    // Better Auth treats `*` and `?` as wildcards (matchesOriginPattern)
    if (
      typeof origin !== "string" ||
      origin.includes("*") ||
      origin.includes("?")
    ) {
      continue;
    }
    const parsed = parseHttpOrigin(origin);
    if (parsed) {
      result.add(parsed);
    }
  }
  return result;
};

// The value of a host and protocol pair as an origin, or undefined if it
// isn't a plain http(s) host
const toOrigin = (host: string | null, proto: string | null) => {
  if (!host || (proto !== "http" && proto !== "https")) {
    return undefined;
  }
  try {
    const url = new URL(`${proto}://${host}`);
    // Reject values carrying a path, credentials or anything besides a host
    return url.host === host.toLowerCase() ? url.origin : undefined;
  } catch {
    return undefined;
  }
};

// The component sits in front of Better Auth as its reverse proxy, so it
// decides which origin Better Auth sees. Better Auth reads x-forwarded-*
// with advanced.trustedProxyHeaders, otherwise the Host header and then the
// request URL (getHostFromSource), and the request URL alone without a
// baseURL. So the URL, Host and x-forwarded-* are all set to one origin, in
// this order:
// 1. the app's host and protocol the framework handlers send in
//    x-better-auth-forwarded-*, or else the x-forwarded-* the request
//    arrived with, if together they form an origin trusted exactly;
// 2. the request's own origin, if trusted exactly (a custom domain);
// 3. CONVEX_SITE_URL, which only the deployment controls, or the request's
//    own origin if it isn't set.
// Convex's cloud edge sets the URL, Host and x-forwarded-* to the
// deployment's site, but a self-hosted backend passes a client's Host and
// x-forwarded-* through and builds the request URL from them, so none of
// them can be trusted unchecked.
const normalizeRequestOrigin = async (
  auth: Parameters<typeof exactTrustedOrigins>[0],
  request: Request
) => {
  const ownOrigin = parseHttpOrigin(request.url);
  const siteOrigin = process.env.CONVEX_SITE_URL
    ? parseHttpOrigin(process.env.CONVEX_SITE_URL)
    : null;
  const fallback = siteOrigin ?? ownOrigin;
  // A candidate equal to the fallback gives the same result either way, so
  // trustedOrigins is only evaluated when there's something else to check.
  // On Convex's cloud, requests that didn't come through the framework
  // handlers have nothing else.
  const candidates = [
    toOrigin(
      request.headers.get("x-better-auth-forwarded-host"),
      request.headers.get("x-better-auth-forwarded-proto")
    ),
    toOrigin(
      request.headers.get("x-forwarded-host"),
      request.headers.get("x-forwarded-proto")
    ),
    ownOrigin,
  ].filter((origin) => origin && origin !== fallback);
  let origin = fallback;
  if (candidates.length > 0) {
    // A trustedOrigins function gets the request as if it had arrived at the
    // fallback origin. On a self-hosted backend the URL, Host and
    // x-forwarded-* are the caller's, so a function that returns the origin
    // of the request's own host would make any host it accepts trusted
    // exactly, wildcards included.
    const trusted = await exactTrustedOrigins(
      auth,
      fallback ? withOrigin(request, fallback) : request
    );
    origin = candidates.find((origin) => trusted.has(origin!)) ?? fallback;
  }
  if (!origin) {
    return request;
  }
  return withOrigin(request, origin, { body: request.body });
};

// The request with its URL, Host and x-forwarded-* set to one origin and
// x-better-auth-forwarded-* removed. Without a body unless one is passed.
const withOrigin = (
  request: Request,
  origin: string,
  init?: { body: ReadableStream | null }
) => {
  const url = new URL(request.url);
  const target = new URL(origin);
  const headers = new Headers(request.headers);
  headers.set("host", target.host);
  headers.set("x-forwarded-host", target.host);
  headers.set("x-forwarded-proto", target.protocol.slice(0, -1));
  headers.delete("x-better-auth-forwarded-host");
  headers.delete("x-better-auth-forwarded-proto");
  return new Request(`${target.origin}${url.pathname}${url.search}`, {
    method: request.method,
    headers,
    ...(init?.body
      ? {
          body: init.body,
          duplex: "half",
        }
      : {}),
  });
};

// Fields every Better Auth user has, plus the Convex document fields and the
// app user link. Used when clientApi doesn't get createAuth.
const coreUserFields = new Set([
  "_id",
  "_creationTime",
  "id",
  "userId",
  ...Object.keys(getAuthTables({}).user!.fields),
]);

const pickCoreUserFields = (user: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(user).filter(([key]) => coreUserFields.has(key))
  );

/**
 * Backend API for the Better Auth component.
 * Responsible for exposing the `client` and `triggers` APIs to the client, http
 * route registration, and having convenience methods for interacting with the
 * component from the backend.
 *
 * @param component - Generally `components.betterAuth` from
 * `./_generated/api` once you've configured it in `convex.config.ts`.
 * @param config - Configuration options for the component.
 * @param config.local - Local schema configuration.
 * @param config.verbose - Whether to log the configured `baseURL` and the
 * request and response headers of each auth request, with credentials
 * redacted. It no longer turns on the adapter's debug logs.
 * @param config.debugLogs - Better Auth's adapter debug logs, off by default.
 * They print whole database rows without redaction, including session tokens
 * and password hashes.
 * @param config.triggers - Triggers configuration.
 * @param config.authFunctions - Authentication functions configuration.
 */
export const createClient = <
  DataModel extends GenericDataModel,
  Schema extends SchemaDefinition<GenericSchema, true> = typeof defaultSchema,
  Api extends SlimComponentApi = SlimComponentApi,
>(
  component: Api,
  config?: {
    local?: {
      schema?: Schema;
    };
    verbose?: boolean;
    debugLogs?: DBAdapterDebugLogOption;
  } & (
    | {
        triggers: Triggers<DataModel, Schema>;
        authFunctions: AuthFunctions;
      }
    | { triggers?: undefined }
  )
) => {
  type BetterAuthDataModel = DataModelFromSchemaDefinition<Schema>;

  const safeGetAuthUser = async (ctx: GenericCtx<DataModel>) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return;
    }
    const session = (await ctx.runQuery(component.adapter.findOne, {
      model: "session",
      where: [
        {
          field: "_id",
          value: identity.sessionId as string,
        },
        {
          field: "expiresAt",
          operator: "gt",
          value: Date.now(),
        },
      ],
    })) as BetterAuthDataModel["session"]["document"] | null;

    if (!session) {
      return;
    }

    const doc = (await ctx.runQuery(component.adapter.findOne, {
      model: "user",
      where: [
        {
          field: "_id",
          value: identity.subject,
        },
      ],
    })) as BetterAuthDataModel["user"]["document"] | null;
    if (!doc) {
      return;
    }
    return doc;
  };

  const getAuthUser = async (ctx: GenericCtx<DataModel>) => {
    const user = await safeGetAuthUser(ctx);
    if (!user) {
      throw new ConvexError("Unauthenticated");
    }
    return user;
  };

  const getHeaders = async (ctx: GenericCtx<DataModel>) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return new Headers();
    }
    // Don't validate the session here, let Better Auth handle that
    const session = await ctx.runQuery(component.adapter.findOne, {
      model: "session",
      where: [
        {
          field: "_id",
          value: identity.sessionId as string,
        },
      ],
    });
    return new Headers({
      ...(session?.token ? { authorization: `Bearer ${session.token}` } : {}),
      ...(session?.ipAddress
        ? { "x-forwarded-for": session.ipAddress as string }
        : {}),
    });
  };

  return {
    /**
     * Returns the Convex database adapter for use in Better Auth options.
     * @param ctx - The Convex context
     * @returns The Convex database adapter
     */
    adapter: (ctx: GenericCtx<DataModel>) =>
      convexAdapter<DataModel, typeof ctx, Schema>(ctx, component, config),

    /**
     * Returns the Better Auth auth object and headers for using Better Auth API
     * methods directly in a Convex mutation or query. Convex functions don't
     * have access to request headers, so the headers object is created at
     * runtime with the token for the current session as a Bearer token.
     *
     * @param createAuth - The createAuth function
     * @param ctx - The Convex context
     * @returns A promise that resolves to the Better Auth `auth` API object and
     * headers.
     */
    getAuth: async <T extends CreateAuth<DataModel>>(
      createAuth: T,
      ctx: GenericCtx<DataModel>
    ) => ({
      auth: createAuth(ctx) as ReturnType<T>,
      headers: await getHeaders(ctx),
    }),

    /**
     * Returns a Headers object for the current session using the session id
     * from the current user identity via `ctx.auth.getUserIdentity()`. This is
     * used to pass the headers to the Better Auth API methods when using the
     * `getAuth` method.
     *
     * @param ctx - The Convex context
     * @returns The headers
     */
    getHeaders,

    /**
     * Returns the current user or null if the user is not found
     * @param ctx - The Convex context
     * @returns The user or null if the user is not found
     */
    safeGetAuthUser,

    /**
     * Returns the current user or throws an error if the user is not found
     *
     * @param ctx - The Convex context
     * @returns The user or throws an error if the user is not found
     */
    getAuthUser,

    /**
     * Returns a user by their Better Auth user id.
     * @param ctx - The Convex context
     * @param id - The Better Auth user id
     * @returns The user or null if the user is not found
     */
    getAnyUserById: async (ctx: GenericCtx<DataModel>, id: string) => {
      return (await ctx.runQuery(component.adapter.findOne, {
        model: "user",
        where: [{ field: "_id", value: id }],
      })) as BetterAuthDataModel["user"]["document"] | null;
    },

    /**
     * Replaces 0.7 behavior of returning a new user id from
     * onCreateUser
     * @param ctx - The Convex context
     * @param authId - The Better Auth user id
     * @param userId - The app user id
     * @deprecated in 0.9
     */
    setUserId: async (
      ctx: GenericMutationCtx<DataModel>,
      authId: string,
      userId: string
    ) => {
      await ctx.runMutation(component.adapter.updateOne, {
        input: {
          model: "user",
          where: [{ field: "_id", value: authId }],
          update: { userId },
        },
      });
    },

    /**
     * Exposes functions for use with the ClientAuthBoundary component. Currently
     * only contains getAuthUser.
     *
     * Pass `createAuth` so the query returns the user the way Better Auth's
     * `/get-session` does, without fields marked `returned: false`. Without
     * it, the fields hidden by your options are unknown here, so the query
     * only returns the core Better Auth user fields.
     *
     * @param createAuth - The createAuth function
     * @returns Functions to pass to the ClientAuthBoundary component.
     */
    clientApi: (createAuth?: CreateAuth<DataModel>) => {
      let options: BetterAuthOptions | undefined;
      const toOutput = (user: Record<string, unknown>) => {
        if (!createAuth) {
          return pickCoreUserFields(user);
        }
        options ??= createAuth({} as any).options as BetterAuthOptions;
        return parseUserOutput(options, user as any) as Record<string, unknown>;
      };
      return {
        /**
         * Convex query to get the current user. For use with the ClientAuthBoundary component.
         *
         * ```ts title="convex/auth.ts"
         * export const { getAuthUser } = authComponent.clientApi(createAuth);
         * ```
         *
         * @returns The user or throws an error if the user is not found
         */
        getAuthUser: queryGeneric({
          args: {},
          handler: async (ctx: GenericCtx<DataModel>) => {
            return toOutput(await getAuthUser(ctx));
          },
        }),
      };
    },

    /**
     * Exposes functions for executing trigger callbacks in the app context.
     *
     * Callbacks are defined in the `triggers` option to the component client config.
     *
     * See {@link createClient} for more information.
     *
     * @returns Functions to execute trigger callbacks in the app context.
     */
    triggersApi: () => ({
      onCreate: internalMutationGeneric({
        args: {
          doc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onCreate?.(ctx, args.doc);
        },
      }),
      onUpdate: internalMutationGeneric({
        args: {
          oldDoc: v.any(),
          newDoc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onUpdate?.(
            ctx,
            args.newDoc,
            args.oldDoc
          );
        },
      }),
      onDelete: internalMutationGeneric({
        args: {
          doc: v.any(),
          model: v.string(),
        },
        handler: async (ctx, args) => {
          await config?.triggers?.[args.model]?.onDelete?.(ctx, args.doc);
        },
      }),
    }),

    registerRoutes: (
      http: HttpRouter,
      createAuth: CreateAuth<DataModel>,
      opts: {
        cors?:
          | boolean
          | {
              // These values are appended to the default values
              allowedOrigins?: string[];
              allowedHeaders?: string[];
              exposedHeaders?: string[];
            };
      } = {}
    ) => {
      const staticAuth = createAuth({} as any);
      const path = staticAuth.options.basePath ?? "/api/auth";
      const authRequestHandler = httpActionGeneric(async (ctx, request) => {
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("options.baseURL", staticAuth.options.baseURL);
          // eslint-disable-next-line no-console
          console.log("request headers", redactHeaders(request.headers));
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = await normalizeRequestOrigin(auth, request);
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", redactHeaders(response.headers));
        }
        return response;
      });
      const wellKnown = http.lookup("/.well-known/openid-configuration", "GET");

      // If registerRoutes is used multiple times, this may already be defined
      if (!wellKnown) {
        // Redirect root well-known to api well-known
        http.route({
          path: "/.well-known/openid-configuration",
          method: "GET",
          handler: httpActionGeneric(async () => {
            const url = `${process.env.CONVEX_SITE_URL}${path}/convex/.well-known/openid-configuration`;
            return Response.redirect(url);
          }),
        });
      }

      if (!opts.cors) {
        http.route({
          pathPrefix: `${path}/`,
          method: "GET",
          handler: authRequestHandler,
        });

        http.route({
          pathPrefix: `${path}/`,
          method: "POST",
          handler: authRequestHandler,
        });

        return;
      }
      const corsOpts =
        typeof opts.cors === "boolean"
          ? { allowedOrigins: [], allowedHeaders: [], exposedHeaders: [] }
          : opts.cors;
      let trustedOriginsOption:
        | (string | null | undefined)[]
        | ((
            request?: Request
          ) =>
            | (string | null | undefined)[]
            | Promise<(string | null | undefined)[]>)
        | undefined;
      const cors = corsRouter(http, {
        allowedOrigins: async (request) => {
          const resolvedTrustedOrigins =
            trustedOriginsOption ??
            (await staticAuth.$context).options.trustedOrigins ??
            [];
          trustedOriginsOption = resolvedTrustedOrigins;
          const rawOrigins = Array.isArray(resolvedTrustedOrigins)
            ? resolvedTrustedOrigins
            : await resolvedTrustedOrigins(request);
          const trustedOrigins = rawOrigins.filter(
            (origin): origin is string => typeof origin === "string"
          );
          return trustedOrigins
            .map((origin) =>
              // Strip trailing wildcards, unsupported for allowedOrigins
              origin.endsWith("*") && origin.length > 1
                ? origin.slice(0, -1)
                : origin
            )
            .concat(corsOpts.allowedOrigins ?? []);
        },
        allowCredentials: true,
        allowedHeaders: [
          "Content-Type",
          "Better-Auth-Cookie",
          "Authorization",
        ].concat(corsOpts.allowedHeaders ?? []),
        exposedHeaders: ["Set-Better-Auth-Cookie"].concat(
          corsOpts.exposedHeaders ?? []
        ),
        // The CORS router logs raw request and response headers, which carry
        // credentials. Our own verbose logs print them redacted.
        debug: false,
        enforceAllowOrigins: false,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "GET",
        handler: authRequestHandler,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "POST",
        handler: authRequestHandler,
      });
    },

    registerRoutesLazy: <T extends CreateAuth<DataModel>>(
      http: HttpRouter,
      createAuth: T,
      opts: RegisterRoutesLazyOptions = {}
    ) => {
      let registrationAuth: ReturnType<T> | undefined;
      const getRegistrationAuth = (): ReturnType<T> => {
        registrationAuth =
          registrationAuth ?? (createAuth({} as any) as ReturnType<T>);
        return registrationAuth;
      };

      const path = opts.basePath ?? "/api/auth";
      let trustedOriginsOption = opts.trustedOrigins;
      const authRequestHandler = httpActionGeneric(async (ctx, request) => {
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("options.baseURL", getRegistrationAuth().options.baseURL);
          // eslint-disable-next-line no-console
          console.log("request headers", redactHeaders(request.headers));
        }
        const auth = createAuth(ctx as any);
        const normalizedRequest = await normalizeRequestOrigin(auth, request);
        const response = await auth.handler(normalizedRequest);
        if (config?.verbose) {
          // eslint-disable-next-line no-console
          console.log("response headers", redactHeaders(response.headers));
        }
        return response;
      });
      const wellKnown = http.lookup("/.well-known/openid-configuration", "GET");

      // If registerRoutes is used multiple times, this may already be defined
      if (!wellKnown) {
        // Redirect root well-known to api well-known
        http.route({
          path: "/.well-known/openid-configuration",
          method: "GET",
          handler: httpActionGeneric(async () => {
            const url = `${process.env.CONVEX_SITE_URL}${path}/convex/.well-known/openid-configuration`;
            return Response.redirect(url);
          }),
        });
      }

      if (!opts.cors) {
        http.route({
          pathPrefix: `${path}/`,
          method: "GET",
          handler: authRequestHandler,
        });

        http.route({
          pathPrefix: `${path}/`,
          method: "POST",
          handler: authRequestHandler,
        });

        return;
      }

      const corsOpts =
        typeof opts.cors === "boolean"
          ? { allowedOrigins: [], allowedHeaders: [], exposedHeaders: [] }
          : opts.cors;
      const cors = corsRouter(http, {
        allowedOrigins: async (request) => {
          const resolvedTrustedOrigins =
            trustedOriginsOption ??
            (await getRegistrationAuth().$context).options.trustedOrigins ??
            [];
          trustedOriginsOption = resolvedTrustedOrigins;
          const rawOrigins = Array.isArray(resolvedTrustedOrigins)
            ? resolvedTrustedOrigins
            : await resolvedTrustedOrigins(request);
          const trustedOrigins = rawOrigins.filter(
            (origin): origin is string => typeof origin === "string"
          );
          return trustedOrigins
            .map((origin) =>
              // Strip trailing wildcards, unsupported for allowedOrigins
              origin.endsWith("*") && origin.length > 1
                ? origin.slice(0, -1)
                : origin
            )
            .concat(corsOpts.allowedOrigins ?? []);
        },
        allowCredentials: true,
        allowedHeaders: [
          "Content-Type",
          "Better-Auth-Cookie",
          "Authorization",
        ].concat(corsOpts.allowedHeaders ?? []),
        exposedHeaders: ["Set-Better-Auth-Cookie"].concat(
          corsOpts.exposedHeaders ?? []
        ),
        // The CORS router logs raw request and response headers, which carry
        // credentials. Our own verbose logs print them redacted.
        debug: false,
        enforceAllowOrigins: false,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "GET",
        handler: authRequestHandler,
      });

      cors.route({
        pathPrefix: `${path}/`,
        method: "POST",
        handler: authRequestHandler,
      });
    },
  };
};
