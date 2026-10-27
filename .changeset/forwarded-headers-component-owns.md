---
"@helixnebulatech/convex-better-auth": patch
---

The component no longer passes unchecked `x-forwarded-*` headers to Better Auth.
Fixes the forwarded host issue (GHSA-pgx2-m66h-x29f) on self-hosted Convex.

When no valid `x-better-auth-forwarded-*` headers arrived, the component passed
the request's `x-forwarded-host` and `x-forwarded-proto` to Better Auth as they
were. Convex's cloud edge replaces those a client sends with its own, so there
they were safe. A self-hosted Convex backend passes them through, and builds the
request URL from them. With `advanced.trustedProxyHeaders` and a dynamic
`baseURL` whose `allowedHosts` has a wildcard, anyone could call the Convex site
directly with `x-forwarded-host: attacker.vercel.app` and get password reset,
verification and magic links pointing to their host.

Now the component sets both headers itself on every request: from
`x-better-auth-forwarded-*`, or else from the incoming `x-forwarded-*`, only if
they form an origin listed exactly in the trusted origins. Otherwise it removes
them, and Better Auth falls back to the `Host` header and the request URL. On
Convex's cloud this changes nothing for apps: `Host` is the same host the edge
put in `x-forwarded-host`.

Why this option: Better Auth trusts `x-forwarded-*` with `trustedProxyHeaders`
because the proxy in front of it sets them. Here that proxy is the component, so
it owns those headers instead of trusting whatever arrived. Verified against a
Convex Cloud deployment, which replaced spoofed headers, and the self-hosted
backend, which passed them through.
