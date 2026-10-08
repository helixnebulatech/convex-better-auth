import { betterFetch } from "@better-fetch/fetch";
import { getSessionCookie } from "better-auth/cookies";
import type {
  AuthProvider,
  DefaultFunctionArgs,
  FunctionReference,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
} from "convex/server";
import { JWT_COOKIE_NAME } from "../plugins/convex/index.js";
import { createPublicJwks } from "../auth-config.js";
import * as jose from "jose";
import type { Jwk } from "better-auth/plugins/jwt";
import type { BaseURLConfig } from "@better-auth/core";

export type TrustedOriginsOption =
  | (string | null | undefined)[]
  | ((
      request?: Request
    ) =>
      (string | null | undefined)[] | Promise<(string | null | undefined)[]>);

type RegisterableAuth = {
  handler: (request: Request) => Promise<Response>;
  options: {
    baseURL?: BaseURLConfig;
    basePath?: string;
    trustedOrigins?: TrustedOriginsOption;
    [key: string]: unknown;
  };
  $context: Promise<{
    options: {
      trustedOrigins?: TrustedOriginsOption;
      [key: string]: unknown;
    };
  }>;
};

export type CreateAuth<
  DataModel extends GenericDataModel,
  A extends RegisterableAuth = RegisterableAuth,
> = (ctx: GenericCtx<DataModel>) => A;

export type EventFunction<T extends DefaultFunctionArgs> = FunctionReference<
  "mutation",
  "internal" | "public",
  T
>;

export type GenericCtx<DataModel extends GenericDataModel = GenericDataModel> =
  | GenericQueryCtx<DataModel>
  | GenericMutationCtx<DataModel>
  | GenericActionCtx<DataModel>;

export type RunMutationCtx<DataModel extends GenericDataModel> = (
  GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>
) & {
  runMutation: GenericActionCtx<DataModel>["runMutation"];
};

export const isQueryCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): ctx is GenericQueryCtx<DataModel> => {
  return "db" in ctx;
};

export const isMutationCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): ctx is GenericMutationCtx<DataModel> => {
  return "db" in ctx && "scheduler" in ctx;
};

export const isActionCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): ctx is GenericActionCtx<DataModel> => {
  return "runAction" in ctx;
};

export const isRunMutationCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): ctx is RunMutationCtx<DataModel> => {
  return "runMutation" in ctx;
};

export const requireQueryCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): GenericQueryCtx<DataModel> => {
  if (!isQueryCtx(ctx)) {
    throw new Error("Query context required");
  }
  return ctx;
};

export const requireMutationCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): GenericMutationCtx<DataModel> => {
  if (!isMutationCtx(ctx)) {
    throw new Error("Mutation context required");
  }
  return ctx;
};

export const requireActionCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): GenericActionCtx<DataModel> => {
  if (!isActionCtx(ctx)) {
    throw new Error("Action context required");
  }
  return ctx;
};

export const requireRunMutationCtx = <DataModel extends GenericDataModel>(
  ctx: GenericCtx<DataModel>
): RunMutationCtx<DataModel> => {
  if (!isRunMutationCtx(ctx)) {
    throw new Error("Mutation or action context required");
  }
  return ctx;
};

export type GetTokenOptions = {
  basePath?: string;
  forceRefresh?: boolean;
  cookiePrefix?: string;
  jwtCache?: {
    enabled: boolean;
    /**
     * A cached JWT is refreshed this many seconds before its `exp`.
     * @default 60
     */
    expirationToleranceSeconds?: number;
    isAuthError: (error: unknown) => boolean;
    /**
     * Expected `iss` of the cached JWT. Defaults to the Convex site URL, which
     * is what the convex plugin signs with (`CONVEX_SITE_URL`).
     */
    issuer?: string;
    /**
     * Static JWKS, the same value passed to the convex plugin `jwks` option.
     * Verifies the cached JWT locally instead of fetching the JWKS.
     */
    jwks?: string;
  };
};

// Audience and algorithms the convex plugin signs with (see getJwksAlg)
const JWT_AUDIENCE = "convex";
const JWT_ALGORITHMS = ["RS256", "ES256", "EdDSA"];

// One key set per JWKS source and server instance. Remote sets are cached by
// jose (10 min max age) and refetched on an unknown `kid`, so key rotation is
// picked up, rate limited to one fetch per 30s.
const verificationKeys = new Map<string, jose.JWTVerifyGetKey>();
const getVerificationKeys = (jwksUrl: string, staticJwks?: string) => {
  const cacheKey = staticJwks ? `static:${staticJwks}` : jwksUrl;
  let keys = verificationKeys.get(cacheKey);
  if (!keys) {
    keys = staticJwks
      ? jose.createLocalJWKSet(createPublicJwks(JSON.parse(staticJwks)))
      : jose.createRemoteJWKSet(new URL(jwksUrl));
    verificationKeys.set(cacheKey, keys);
  }
  return keys;
};

export const isCachedTokenUsable = (
  claims: { exp?: number },
  jwtCache?: GetTokenOptions["jwtCache"]
) => {
  if (!claims.exp) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return claims.exp - now > (jwtCache?.expirationToleranceSeconds ?? 60);
};

export const getToken = async (
  siteUrl: string,
  headers: Headers,
  opts?: GetTokenOptions
) => {
  headers.set("host", new URL(siteUrl).host);
  // Callers pass the inbound request headers, where hosting platforms put the
  // app host in `x-forwarded-host`. Convex's edge routes on that header and
  // 404s, so move it (and the proto) to the headers the component restores.
  const forwardedHost = headers.get("x-forwarded-host");
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedHost && !headers.has("x-better-auth-forwarded-host")) {
    headers.set("x-better-auth-forwarded-host", forwardedHost);
  }
  if (forwardedProto && !headers.has("x-better-auth-forwarded-proto")) {
    headers.set("x-better-auth-forwarded-proto", forwardedProto);
  }
  headers.delete("x-forwarded-host");
  const basePath = opts?.basePath
    ? (opts.basePath.startsWith("/")
        ? opts.basePath
        : `/${opts.basePath}`
      ).replace(/\/+$/, "")
    : "/api/auth";
  const fetchToken = async () => {
    const { data } = await betterFetch<{ token: string }>(
      `${basePath}/convex/token`,
      {
        baseURL: siteUrl,
        headers,
      }
    );
    return { isFresh: true, token: data?.token };
  };
  if (!opts?.jwtCache?.enabled || opts.forceRefresh) {
    return await fetchToken();
  }
  const token = getSessionCookie(new Headers(headers), {
    cookieName: JWT_COOKIE_NAME,
    cookiePrefix: opts?.cookiePrefix,
  });
  if (!token) {
    return await fetchToken();
  }
  // The cookie is client supplied: only reuse it if it verifies against the
  // Convex JWKS, otherwise `isAuthenticated` would trust a forged token.
  const normalizedSiteUrl = siteUrl.replace(/\/+$/, "");
  try {
    const { payload } = await jose.jwtVerify(
      token,
      getVerificationKeys(
        `${normalizedSiteUrl}${basePath}/convex/jwks`,
        opts.jwtCache.jwks
      ),
      {
        issuer: opts.jwtCache.issuer ?? normalizedSiteUrl,
        audience: JWT_AUDIENCE,
        algorithms: JWT_ALGORITHMS,
      }
    );
    if (isCachedTokenUsable(payload, opts.jwtCache)) {
      return { isFresh: false, token };
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (_error) {
    // Invalid, expired or unverifiable: fetch a fresh token instead
  }
  return await fetchToken();
};

export const parseJwks = (providerConfig: AuthProvider) => {
  const staticJwksString =
    "jwks" in providerConfig && providerConfig.jwks?.startsWith("data:text/")
      ? atob(providerConfig.jwks.split("base64,")[1])
      : undefined;

  if (!staticJwksString) {
    return;
  }
  const parsed = JSON.parse(
    staticJwksString?.slice(1, -1).replaceAll(/[\s\\]/g, "") || "{}"
  );
  const staticJwks = {
    ...parsed,
    privateKey: `"${parsed.privateKey}"`,
    publicKey: `"${parsed.publicKey}"`,
  } as Jwk;
  return staticJwks;
};
