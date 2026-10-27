import type { BetterAuthPlugin } from "better-auth";
import {
  parseCookies,
  setRequestCookie,
  setSessionCookie,
} from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { z } from "zod";
import { VERSION } from "../../version.js";

// Pending OAuth redirects started by crossDomainClient, keyed by OAuth state
const oauthStartIdentifier = (state: string) => `cross-domain-oauth:${state}`;
// Hash of the client verifier for an OAuth flow, keyed by OAuth state
const oauthVerifierIdentifier = (state: string) =>
  `cross-domain-oauth-verifier:${state}`;
// One-time token that hands a session to the app. Its own prefix, so the
// official one-time-token plugin can't redeem it.
const ottIdentifier = (token: string) => `cross-domain-ott:${token}`;
// Hash of the client verifier an OAuth one-time token is bound to
const ottVerifierIdentifier = (token: string) =>
  `cross-domain-ott-verifier:${token}`;

type PendingOAuthStart = { url: string; errorCallbackURL?: string };
// Stored per OAuth flow when crossDomainClient starts it
type OAuthVerifier = { hash: string; origin: string };

const parseOAuthVerifier = (value: string, siteOrigin: string) => {
  try {
    const parsed = JSON.parse(value) as Partial<OAuthVerifier>;
    if (typeof parsed.hash === "string" && typeof parsed.origin === "string") {
      return parsed as OAuthVerifier;
    }
  } catch {
    // Flows started before 0.13.7 stored only the hash, always from siteUrl
  }
  return { hash: value, origin: siteOrigin };
};

// Origins listed exactly in trustedOrigins, resolved for this request like
// Better Auth's origin check does. Wildcard patterns and custom schemes are
// left out.
const getExactTrustedOrigins = async (ctx: {
  context: {
    trustedOrigins: string[];
    options: { trustedOrigins?: unknown };
  };
  request?: Request;
}) => {
  const entries: unknown[] = [...ctx.context.trustedOrigins];
  const option = ctx.context.options.trustedOrigins;
  if (typeof option === "function") {
    const resolved = await option(ctx.request);
    if (Array.isArray(resolved)) {
      entries.push(...resolved);
    }
  }
  const origins = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string" || entry.includes("*")) {
      continue;
    }
    try {
      const url = new URL(entry);
      if (url.protocol === "http:" || url.protocol === "https:") {
        origins.add(url.origin);
      }
    } catch {
      // not a URL
    }
  }
  return origins;
};

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const getOAuthState = (url: string) => {
  try {
    return new URL(url).searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
};

export const crossDomain = ({ siteUrl }: { siteUrl: string }) => {
  const siteOrigin = new URL(siteUrl).origin;

  // Origins that may start an OAuth flow and receive its session: siteUrl
  // and the exact entries of trustedOrigins.
  const getAppOrigins = async (
    ctx: Parameters<typeof getExactTrustedOrigins>[0]
  ) => (await getExactTrustedOrigins(ctx)).add(siteOrigin);

  const rewriteCallbackURL = (
    callbackURL: string | undefined,
    base: string
  ) => {
    if (!callbackURL) {
      return callbackURL;
    }
    if (!callbackURL.startsWith("/")) {
      return callbackURL;
    }
    return new URL(callbackURL, base).toString();
  };

  const isExpoNative = (ctx: { headers?: Headers }) => {
    return ctx.headers?.has("expo-origin");
  };

  return {
    id: "cross-domain",
    version: VERSION,
    // TODO: remove this in the next minor release, it doesn't
    // actually affect ctx.trustedOrigins. cors allowedOrigins
    // is using it, via options.trustedOrigins, though, so it's
    // a breaking change.
    init(ctx) {
      return {
        options: {
          trustedOrigins: [siteUrl],
        },
        context: {
          oauthConfig: {
            // Keep the rest of the app's OAuth config, eg. skipStateCookieCheck
            ...ctx.oauthConfig,
            // The client can't receive the state cookie from the sign-in
            // request, so crossDomainClient starts the redirect through
            // /cross-domain/oauth/start, which sets it in the browser like
            // Better Auth does. The callback then checks it as usual.
            storeStateStrategy: "database",
          },
        },
      };
    },
    hooks: {
      before: [
        {
          matcher(ctx) {
            return (
              Boolean(
                ctx.request?.headers.has("better-auth-cookie") ||
                ctx.headers?.has("better-auth-cookie")
              ) && !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const existingHeaders = (ctx.request?.headers ||
              ctx.headers) as Headers;
            const headers = new Headers({
              ...Object.fromEntries(existingHeaders?.entries()),
            });
            // Skip if the request has an authorization header
            if (headers.get("authorization")) {
              return;
            }
            const cookie = headers.get("better-auth-cookie");
            if (!cookie) {
              return;
            }
            // Merge into the Cookie header the way Better Auth's bearer
            // plugin does. `headers.append` joins with ", " in some runtimes,
            // which breaks cookie parsing and drops the session token.
            for (const [name, value] of parseCookies(cookie)) {
              setRequestCookie(headers, name, value);
            }
            return {
              context: {
                headers,
              },
            };
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(
              ctx.method === "GET" &&
              ctx.path?.startsWith("/verify-email") &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            if (ctx.query?.callbackURL) {
              ctx.query.callbackURL = rewriteCallbackURL(
                ctx.query.callbackURL,
                siteUrl
              );
            }
            return { context: ctx };
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(ctx.method === "POST" && !isExpoNative(ctx));
          },
          handler: createAuthMiddleware(async (ctx) => {
            // An OAuth flow comes back to the app that started it, so its
            // relative URLs resolve against that app's origin, as with
            // Better Auth's oauth-popup. Other flows resolve against siteUrl.
            let base = siteUrl;
            if (
              ctx.path?.startsWith("/sign-in/social") ||
              ctx.path?.startsWith("/link-social")
            ) {
              // From siteUrl's own origin, keep siteUrl, which can have a
              // path such as https://example.com/app
              const origin = ctx.request?.headers.get("origin");
              if (
                origin &&
                origin !== siteOrigin &&
                (await getAppOrigins(ctx)).has(origin)
              ) {
                base = origin;
              }
            }
            // Set callbackURL for redirect-triggering paths with no
            // callbackURL defined.
            if (
              ctx.body &&
              !ctx.body.callbackURL &&
              (ctx.path?.startsWith("/sign-in/social") ||
                ctx.path?.startsWith("/sign-in/magic-link") ||
                ctx.path?.startsWith("/send-verification-email"))
            ) {
              ctx.body.callbackURL = base === siteUrl ? siteUrl : `${base}/`;
            }
            if (ctx.body?.callbackURL) {
              ctx.body.callbackURL = rewriteCallbackURL(
                ctx.body.callbackURL,
                base
              );
            }
            if (ctx.body?.newUserCallbackURL) {
              ctx.body.newUserCallbackURL = rewriteCallbackURL(
                ctx.body.newUserCallbackURL,
                base
              );
            }
            if (ctx.body?.errorCallbackURL) {
              ctx.body.errorCallbackURL = rewriteCallbackURL(
                ctx.body.errorCallbackURL,
                base
              );
            }
            return { context: ctx };
          }),
        },
      ],
      after: [
        {
          // Remember OAuth redirects so crossDomainClient can start them
          // through /cross-domain/oauth/start, which sets the state cookie.
          matcher(ctx) {
            return Boolean(
              ctx.method === "POST" &&
              (ctx.path === "/sign-in/social" || ctx.path === "/link-social") &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const returned = ctx.context.returned as
              { url?: string; redirect?: boolean } | undefined;
            const state = returned?.url
              ? getOAuthState(returned.url)
              : undefined;
            if (!returned?.url || !state) {
              return;
            }
            const pending: PendingOAuthStart = {
              url: returned.url,
              // Already validated against trustedOrigins by Better Auth
              errorCallbackURL: ctx.body?.errorCallbackURL,
            };
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: oauthStartIdentifier(state),
              value: JSON.stringify(pending),
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            });
          }),
        },
        {
          matcher(ctx) {
            return (
              Boolean(
                ctx.request?.headers.has("better-auth-cookie") ||
                ctx.headers?.has("better-auth-cookie")
              ) && !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const setCookie = ctx.context.responseHeaders?.get("set-cookie");
            if (!setCookie) {
              return;
            }
            ctx.context.responseHeaders?.delete("set-cookie");
            ctx.setHeader("Set-Better-Auth-Cookie", setCookie);
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(
              (ctx.path?.startsWith("/callback") ||
                ctx.path?.startsWith("/magic-link/verify") ||
                // Creates a session with autoSignInAfterVerification, and
                // when confirming an email change. Better Auth's expo plugin
                // hands it to the app from here too.
                ctx.path?.startsWith("/verify-email")) &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            const session = ctx.context.newSession;
            // No new session is expected on some callbacks, e.g. linkSocial
            // (the user is already signed in) or error redirects. There is
            // nothing to hand off, so keep Better Auth's redirect as is.
            if (!session) {
              return;
            }
            const redirectTo = ctx.context.responseHeaders?.get("location");
            if (!redirectTo) {
              // /verify-email without a callbackURL answers with JSON
              if (!ctx.path?.startsWith("/verify-email")) {
                ctx.context.logger.error("No redirect to found");
              }
              return;
            }
            const url = new URL(redirectTo, siteUrl);
            // Better Auth keeps the session in a cookie of the auth server.
            // Its plugins only hand a session to another web origin when
            // that origin started the flow in the same browser (oauth-popup,
            // oauth-proxy), and never for a magic link, which anyone can
            // request with any callback URL. Email verification links are the
            // same. The one-time token follows the same rules.
            let verifierHash: string | undefined;
            if (ctx.path?.startsWith("/callback")) {
              // OAuth: only to the app that started the flow, and only
              // redeemable with the verifier of the browser that started it,
              // as the state cookie ties the flow to that browser.
              const state = ctx.query?.state as string | undefined;
              const verifierRow = state
                ? await ctx.context.internalAdapter.findVerificationValue(
                    oauthVerifierIdentifier(state)
                  )
                : null;
              if (!verifierRow || !state) {
                // The flow wasn't started by crossDomainClient in this
                // browser, so there's no browser to hand the session to.
                ctx.context.logger.error(
                  "OAuth flow wasn't started by crossDomainClient, not handing off the session"
                );
                return;
              }
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                oauthVerifierIdentifier(state)
              );
              const verifier = parseOAuthVerifier(
                verifierRow.value,
                siteOrigin
              );
              if (url.origin !== verifier.origin) {
                ctx.context.logger.warn(
                  `Not handing off the session: the callback URL is on ${url.origin}, but the OAuth flow was started from ${verifier.origin}`
                );
                return;
              }
              verifierHash = verifier.hash;
            } else if (url.origin !== siteOrigin) {
              // Magic link and email verification: only to the app at
              // siteUrl, as expo only hands them to the app's scheme
              return;
            }
            const token = generateRandomString(32);
            const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
            // The binding exists before the token and outlives its
            // redemption, so the token is never redeemable without it
            if (verifierHash) {
              await ctx.context.internalAdapter.createVerificationValue({
                value: verifierHash,
                identifier: ottVerifierIdentifier(token),
                expiresAt,
              });
            }
            await ctx.context.internalAdapter.createVerificationValue({
              value: session.session.token,
              identifier: ottIdentifier(token),
              expiresAt,
            });
            url.searchParams.set("ott", token);
            throw ctx.redirect(url.toString());
          }),
        },
      ],
    },
    // Endpoint keys are unique across Better Auth's plugins, as theirs are.
    // Better Auth merges every plugin's endpoints by key, so a shared key
    // silently replaces the other plugin's endpoint.
    endpoints: {
      // Starts an OAuth redirect in the browser, as a form POST from the app,
      // so the state cookie is set in the browser like Better Auth does when
      // the app and the auth server share a site.
      crossDomainOAuthStart: createAuthEndpoint(
        "/cross-domain/oauth/start",
        {
          method: "POST",
          body: z.object({
            state: z.string(),
            verifier: z.string().min(32),
          }),
          metadata: {
            allowedMediaTypes: [
              "application/x-www-form-urlencoded",
              "application/json",
            ],
          },
        },
        async (ctx) => {
          const { state, verifier } = ctx.body;
          const pendingRow =
            await ctx.context.internalAdapter.findVerificationValue(
              oauthStartIdentifier(state)
            );
          const pending =
            pendingRow && pendingRow.expiresAt >= new Date()
              ? (JSON.parse(pendingRow.value) as PendingOAuthStart)
              : null;
          // Only the app may start a flow, so a link or a form on another
          // site can't put someone else's state cookie in this browser.
          const origin = ctx.request?.headers.get("origin");
          if (origin === "null") {
            // Better Auth rejects a null Origin too. This is a top-level
            // navigation, so redirect to the error callback URL like Better
            // Auth does for OAuth errors, or to its error page.
            ctx.context.logger.error(
              `OAuth sign-in was started with \`Origin: null\`, which happens when the app sets a strict referrer policy such as no-referrer. Use a policy that sends the origin, such as strict-origin-when-cross-origin, or pass \`setReferrerPolicy: true\` to crossDomainClient.`
            );
            const url = new URL(
              pending?.errorCallbackURL ??
                ctx.context.options.onAPIError?.errorURL ??
                `${ctx.context.baseURL}/error`,
              ctx.context.baseURL
            );
            url.searchParams.set("error", "missing_or_null_origin");
            throw ctx.redirect(url.toString());
          }
          // Like Better Auth's oauth-popup, any trusted origin may start a
          // flow, but only exact entries: a wildcard such as *.vercel.app
          // also matches sites anyone can deploy.
          if (!origin || !(await getAppOrigins(ctx)).has(origin)) {
            throw ctx.error("FORBIDDEN", { message: "Invalid origin" });
          }
          if (!pending) {
            throw ctx.error("BAD_REQUEST", { message: "Invalid state" });
          }
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            oauthStartIdentifier(state)
          );
          const stored: OAuthVerifier = {
            hash: await sha256(verifier),
            origin,
          };
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: oauthVerifierIdentifier(state),
            value: JSON.stringify(stored),
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          });
          // Same cookie Better Auth sets when it generates the state
          const stateCookie = ctx.context.createAuthCookie("state", {
            maxAge: 300,
          });
          await ctx.setSignedCookie(
            stateCookie.name,
            state,
            ctx.context.secret,
            stateCookie.attributes
          );
          throw ctx.redirect(pending.url);
        }
      ),
      crossDomainVerifyOneTimeToken: createAuthEndpoint(
        "/cross-domain/one-time-token/verify",
        {
          method: "POST",
          body: z.object({
            token: z.string(),
            verifier: z.string().optional(),
          }),
        },
        async (ctx) => {
          const binding =
            await ctx.context.internalAdapter.findVerificationValue(
              ottVerifierIdentifier(ctx.body.token)
            );
          if (
            binding &&
            (!ctx.body.verifier ||
              (await sha256(ctx.body.verifier)) !== binding.value)
          ) {
            throw ctx.error("BAD_REQUEST", { message: "Invalid token" });
          }
          // Same steps as the one-time-token plugin's verify endpoint
          const verification =
            await ctx.context.internalAdapter.consumeVerificationValue(
              ottIdentifier(ctx.body.token)
            );
          if (!verification) {
            throw ctx.error("BAD_REQUEST", { message: "Invalid token" });
          }
          // Only now: a request without the verifier that finds no binding
          // also finds no token
          if (binding) {
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(
              ottVerifierIdentifier(ctx.body.token)
            );
          }
          const session = await ctx.context.internalAdapter.findSession(
            verification.value
          );
          if (!session) {
            throw ctx.error("BAD_REQUEST", { message: "Session not found" });
          }
          // The plugin sets the cookie before this check, but an expired
          // session shouldn't be set at all
          if (session.session.expiresAt < new Date()) {
            throw ctx.error("BAD_REQUEST", { message: "Session expired" });
          }
          await setSessionCookie(ctx, session);
          return ctx.json(session);
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
