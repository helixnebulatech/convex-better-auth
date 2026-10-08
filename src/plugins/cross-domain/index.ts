import type { BetterAuthPlugin } from "better-auth";
import { setSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import { createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { oneTimeToken as oneTimeTokenPlugin } from "better-auth/plugins/one-time-token";
import { z } from "zod";
import { VERSION } from "../../version.js";

// Pending OAuth redirects started by crossDomainClient, keyed by OAuth state
const oauthStartIdentifier = (state: string) => `cross-domain-oauth:${state}`;
// Hash of the client verifier for an OAuth flow, keyed by OAuth state
const oauthVerifierIdentifier = (state: string) =>
  `cross-domain-oauth-verifier:${state}`;
// Hash of the client verifier an OAuth one-time token is bound to
const ottVerifierIdentifier = (token: string) =>
  `cross-domain-ott-verifier:${token}`;

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
  const oneTimeToken = oneTimeTokenPlugin();
  const siteOrigin = new URL(siteUrl).origin;

  const rewriteCallbackURL = (callbackURL?: string) => {
    if (!callbackURL) {
      return callbackURL;
    }
    if (!callbackURL.startsWith("/")) {
      return callbackURL;
    }
    return new URL(callbackURL, siteUrl).toString();
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
    init() {
      return {
        options: {
          trustedOrigins: [siteUrl],
        },
        context: {
          oauthConfig: {
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
            headers.append("cookie", cookie);
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
              ctx.query.callbackURL = rewriteCallbackURL(ctx.query.callbackURL);
            }
            return { context: ctx };
          }),
        },
        {
          matcher: (ctx) => {
            return Boolean(ctx.method === "POST" && !isExpoNative(ctx));
          },
          handler: createAuthMiddleware(async (ctx) => {
            // Set callbackURL to siteUrl for redirect-triggering paths with
            // no callbackURL defined.
            if (
              ctx.body &&
              !ctx.body.callbackURL &&
              (ctx.path?.startsWith("/sign-in/social") ||
                ctx.path?.startsWith("/sign-in/magic-link") ||
                ctx.path?.startsWith("/send-verification-email"))
            ) {
              ctx.body.callbackURL = siteUrl;
            }
            if (ctx.body?.callbackURL) {
              ctx.body.callbackURL = rewriteCallbackURL(ctx.body.callbackURL);
            }
            if (ctx.body?.newUserCallbackURL) {
              ctx.body.newUserCallbackURL = rewriteCallbackURL(
                ctx.body.newUserCallbackURL
              );
            }
            if (ctx.body?.errorCallbackURL) {
              ctx.body.errorCallbackURL = rewriteCallbackURL(
                ctx.body.errorCallbackURL
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
            await ctx.context.internalAdapter.createVerificationValue({
              identifier: oauthStartIdentifier(state),
              value: returned.url,
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
                ctx.path?.startsWith("/magic-link/verify")) &&
              !isExpoNative(ctx)
            );
          },
          handler: createAuthMiddleware(async (ctx) => {
            // Mostly copied from the one-time-token plugin
            const session = ctx.context.newSession;
            // No new session is expected on some callbacks, e.g. linkSocial
            // (the user is already signed in) or error redirects. There is
            // nothing to hand off, so keep Better Auth's redirect as is.
            if (!session) {
              return;
            }
            const redirectTo = ctx.context.responseHeaders?.get("location");
            if (!redirectTo) {
              ctx.context.logger.error("No redirect to found");
              return;
            }
            const url = new URL(redirectTo, siteUrl);
            // Better Auth keeps the session in a cookie of the auth server and
            // never hands it to the callback URL. The one-time token only
            // exists to bring it to the app at siteUrl, so other origins
            // (even trusted ones) don't get one.
            if (url.origin !== siteOrigin) {
              return;
            }
            // An OAuth session can't move to another browser in Better Auth
            // (the state cookie ties the flow to the browser that started
            // it), so bind the token to the verifier of the client that
            // started the flow. Magic links aren't tied to a browser, so their
            // token isn't either.
            let verifierHash: string | undefined;
            if (ctx.path?.startsWith("/callback")) {
              const state = ctx.query?.state as string | undefined;
              const verifier = state
                ? await ctx.context.internalAdapter.findVerificationValue(
                    oauthVerifierIdentifier(state)
                  )
                : null;
              if (verifier && state) {
                verifierHash = verifier.value;
                await ctx.context.internalAdapter.deleteVerificationByIdentifier(
                  oauthVerifierIdentifier(state)
                );
              } else {
                const providerId = ctx.path.split("/")[2];
                const providers = await ctx.context.socialProviders;
                const provider = providers.find((p) => p.id === providerId);
                // Flows started by the identity provider have no client to
                // bind to, Better Auth only allows them when opted in.
                if (!provider?.allowIdpInitiated) {
                  ctx.context.logger.error(
                    "OAuth flow wasn't started by crossDomainClient, not handing off the session"
                  );
                  return;
                }
              }
            }
            const token = generateRandomString(32);
            const expiresAt = new Date(Date.now() + 3 * 60 * 1000);
            await ctx.context.internalAdapter.createVerificationValue({
              value: session.session.token,
              identifier: `one-time-token:${token}`,
              expiresAt,
            });
            if (verifierHash) {
              await ctx.context.internalAdapter.createVerificationValue({
                value: verifierHash,
                identifier: ottVerifierIdentifier(token),
                expiresAt,
              });
            }
            url.searchParams.set("ott", token);
            throw ctx.redirect(url.toString());
          }),
        },
      ],
    },
    endpoints: {
      // Starts an OAuth redirect in the browser, as a form POST from the app,
      // so the state cookie is set in the browser like Better Auth does when
      // the app and the auth server share a site.
      startOAuth: createAuthEndpoint(
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
          // Only the app may start a flow, so a link or a form on another
          // site can't put someone else's state cookie in this browser.
          if (ctx.request?.headers.get("origin") !== siteOrigin) {
            throw ctx.error("FORBIDDEN", { message: "Invalid origin" });
          }
          const { state, verifier } = ctx.body;
          const pending =
            await ctx.context.internalAdapter.findVerificationValue(
              oauthStartIdentifier(state)
            );
          if (!pending || pending.expiresAt < new Date()) {
            throw ctx.error("BAD_REQUEST", { message: "Invalid state" });
          }
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(
            oauthStartIdentifier(state)
          );
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: oauthVerifierIdentifier(state),
            value: await sha256(verifier),
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
          throw ctx.redirect(pending.value);
        }
      ),
      verifyOneTimeToken: createAuthEndpoint(
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
          if (binding) {
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(
              ottVerifierIdentifier(ctx.body.token)
            );
          }
          const response = await oneTimeToken.endpoints.verifyOneTimeToken({
            ...ctx,
            asResponse: false,
            returnHeaders: false,
            returnStatus: false,
          });
          await setSessionCookie(ctx, response);
          return response;
        }
      ),
    },
  } satisfies BetterAuthPlugin;
};
