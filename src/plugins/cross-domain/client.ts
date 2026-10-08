import type { BetterAuthClientPlugin, ClientStore } from "better-auth/client";
import { parseSetCookieHeader } from "better-auth/cookies";
import type { BetterFetchOption } from "@better-fetch/fetch";
import type { crossDomain } from "./index.js";
import { VERSION } from "../../version.js";

interface StoredCookie {
  value: string;
  expires: string | null;
}

type CrossDomainActions = {
  getCookie: () => string;
  updateSession: () => void;
  getSessionData: () => Record<string, unknown> | null;
};

type CrossDomainClientPlugin = Omit<
  BetterAuthClientPlugin,
  "$InferServerPlugin" | "getActions"
> & {
  $InferServerPlugin: ReturnType<typeof crossDomain>;
  getActions: (
    ...args: Parameters<NonNullable<BetterAuthClientPlugin["getActions"]>>
  ) => CrossDomainActions;
};

export function getSetCookie(header: string, prevCookie?: string) {
  const parsed = parseSetCookieHeader(header);
  let toSetCookie: Record<string, StoredCookie> = {};
  parsed.forEach((cookie, key) => {
    const expiresAt = cookie["expires"];
    const maxAge = cookie["max-age"];
    const expires = expiresAt
      ? new Date(String(expiresAt))
      : maxAge
        ? new Date(Date.now() + Number(maxAge) * 1000)
        : null;
    toSetCookie[key] = {
      value: cookie["value"],
      expires: expires ? expires.toISOString() : null,
    };
  });
  if (prevCookie) {
    try {
      const prevCookieParsed = JSON.parse(prevCookie);
      toSetCookie = {
        ...prevCookieParsed,
        ...toSetCookie,
      };
    } catch {
      //
    }
  }
  return JSON.stringify(toSetCookie);
}

export function getCookie(cookie: string) {
  let parsed = {} as Record<string, StoredCookie>;
  try {
    parsed = JSON.parse(cookie) as Record<string, StoredCookie>;
  } catch {
    // noop
  }
  return Object.entries(parsed)
    .filter(
      ([, value]) => !value.expires || new Date(value.expires) >= new Date()
    )
    .map(([key, value]) => `${key}=${value.value}`)
    .join("; ");
}

const generateVerifier = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

// Better Auth sets the OAuth state cookie on the sign-in response, which this
// client can't receive. Start the redirect with a form POST through the auth
// server instead, which sets it in the browser, so the flow is tied to this
// browser as in Better Auth.
const startOAuthRedirect = (
  startUrl: string,
  fields: Record<string, string>
) => {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = startUrl;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
};

export const crossDomainClient = (
  opts: {
    storage?: {
      setItem: (key: string, value: string) => any;
      getItem: (key: string) => string | null;
    };
    storagePrefix?: string;
    disableCache?: boolean;
  } = {}
): CrossDomainClientPlugin => {
  let store: ClientStore | null = null;
  const cookieName = `${opts?.storagePrefix || "better-auth"}_cookie`;
  const localCacheName = `${opts?.storagePrefix || "better-auth"}_session_data`;
  const oauthVerifierName = `${opts?.storagePrefix || "better-auth"}_oauth_verifier`;
  const storage =
    opts?.storage || (typeof window !== "undefined" ? localStorage : undefined);

  return {
    id: "cross-domain",
    version: VERSION,
    $InferServerPlugin: {} as ReturnType<typeof crossDomain>,
    getActions(_, $store) {
      store = $store;
      return {
        /**
         * Get the stored cookie.
         *
         * You can use this to get the cookie stored in the device and use it in your fetch
         * requests.
         *
         * @example
         * ```ts
         * const cookie = client.getCookie();
         * fetch("https://api.example.com", {
         * 	headers: {
         * 		cookie,
         * 	},
         * });
         */
        getCookie: () => {
          const cookie = storage?.getItem(cookieName);
          return getCookie(cookie || "{}");
        },
        /**
         * Notify the session signal.
         *
         * This is used to trigger an update in useSession, generally when a new session
         * token is set.
         *
         * @example
         * ```ts
         * client.notifySessionSignal();
         * ```
         */
        updateSession: () => {
          $store.notify("$sessionSignal");
        },
        /**
         * Get the stored session data.
         *
         * @example
         * ```ts
         * const sessionData = client.getSessionData();
         * ```
         */
        getSessionData: (): Record<string, unknown> | null => {
          const sessionData = storage?.getItem(localCacheName);
          if (!sessionData) return null;
          try {
            const parsed = JSON.parse(sessionData);
            if (
              parsed &&
              typeof parsed === "object" &&
              Object.keys(parsed).length === 0
            ) {
              return null;
            }
            return parsed;
          } catch {
            return null;
          }
        },
      };
    },
    fetchPlugins: [
      {
        id: "cross-domain",
        name: "Cross Domain",
        hooks: {
          async onResponse(context) {
            const path = new URL(context.request.url.toString()).pathname;
            if (
              !storage ||
              typeof document === "undefined" ||
              !context.response.ok ||
              !(
                path.endsWith("/sign-in/social") ||
                path.endsWith("/link-social")
              )
            ) {
              return;
            }
            const data = await context.response
              .clone()
              .json()
              .catch(() => null);
            if (!data?.url || !data.redirect) {
              return;
            }
            let state: string | null = null;
            try {
              state = new URL(data.url).searchParams.get("state");
            } catch {
              // noop
            }
            if (!state) {
              return;
            }
            const verifier = generateVerifier();
            await storage.setItem(oauthVerifierName, verifier);
            startOAuthRedirect(
              context.request.url
                .toString()
                .replace(
                  /\/(sign-in\/social|link-social)(\?.*)?$/,
                  "/cross-domain/oauth/start"
                ),
              { state, verifier }
            );
            // The form POST navigates away, don't let Better Auth's redirect
            // plugin navigate to the provider directly.
            return new Response(JSON.stringify({ ...data, redirect: false }), {
              status: context.response.status,
              statusText: context.response.statusText,
              headers: context.response.headers,
            });
          },
          async onSuccess(context) {
            if (!storage) {
              return;
            }
            const setCookie = context.response.headers.get(
              "set-better-auth-cookie"
            );
            if (setCookie) {
              const prevCookie = storage.getItem(cookieName);
              const toSetCookie = getSetCookie(
                setCookie || "",
                prevCookie ?? undefined
              );
              await storage.setItem(cookieName, toSetCookie);
              // Only notify when the session token value actually changed.
              // max-age recalculation with Date.now() causes the stored
              // cookie JSON to always differ, so comparing values directly
              // prevents infinite get-session polling loops.
              if (setCookie.includes(".session_token=")) {
                const parsed = parseSetCookieHeader(setCookie);
                let prevParsed: Record<string, StoredCookie> = {};
                try {
                  prevParsed = JSON.parse(prevCookie || "{}");
                } catch {
                  // noop
                }
                const tokenKey = [...parsed.keys()].find((k) =>
                  k.includes("session_token")
                );
                if (
                  tokenKey &&
                  prevParsed[tokenKey]?.value !== parsed.get(tokenKey)?.value
                ) {
                  store?.notify("$sessionSignal");
                }
              }
            }

            if (
              context.request.url.toString().includes("/get-session") &&
              !opts?.disableCache
            ) {
              const data = context.data;
              storage.setItem(localCacheName, JSON.stringify(data));
              if (data === null) {
                // Preserve non-session cookies (e.g. two_factor) when
                // get-session returns null during 2FA pending state.
                // Previously this unconditionally set cookieName to "{}",
                // which wiped the two_factor challenge token needed for
                // verifyTotp in cross-domain setups.
                const prev = storage.getItem(cookieName);
                try {
                  const parsed = JSON.parse(prev || "{}") as Record<
                    string,
                    unknown
                  >;
                  const preserved: Record<string, unknown> = {};
                  for (const [key, val] of Object.entries(parsed)) {
                    if (
                      !key.includes("session_token") &&
                      !key.includes("session_data") &&
                      !key.includes("convex_jwt")
                    ) {
                      preserved[key] = val;
                    }
                  }
                  storage.setItem(cookieName, JSON.stringify(preserved));
                } catch {
                  storage.setItem(cookieName, "{}");
                }
              }
            }
          },
        },
        async init(url, options) {
          if (!storage) {
            return {
              url,
              options: options as BetterFetchOption,
            };
          }
          options = options || {};
          const storedCookie = storage.getItem(cookieName);
          const cookie = getCookie(storedCookie || "{}");
          options.credentials = "omit";
          options.headers = {
            ...options.headers,
            "Better-Auth-Cookie": cookie,
          };
          // Prove an OAuth one-time token is redeemed by the browser that
          // started the flow
          if (url.includes("/cross-domain/one-time-token/verify")) {
            const verifier = await storage.getItem(oauthVerifierName);
            if (verifier) {
              const body =
                typeof options.body === "string"
                  ? JSON.parse(options.body)
                  : (options.body ?? {});
              options.body = { ...body, verifier };
              await storage.setItem(oauthVerifierName, "");
            }
          }
          if (url.includes("/sign-out")) {
            await storage.setItem(cookieName, "{}");
            store?.atoms.session?.set({
              data: null,
              error: null,
              isPending: false,
            });
            await storage.setItem(localCacheName, "{}");
          }
          return {
            url,
            options: options as BetterFetchOption,
          };
        },
      },
    ],
  };
};
