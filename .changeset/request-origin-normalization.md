---
"@helixnebulatech/convex-better-auth": patch
---

Forwarded host (GHSA-9qq3-v9g3-cxhw): the component only set or removed
`x-forwarded-host` and `x-forwarded-proto`, and left `Host` and the request URL
as received. Better Auth reads those without `advanced.trustedProxyHeaders`: a
dynamic `baseURL` takes the `Host` header, then the request URL
(`getHostFromSource`), and no `baseURL` takes the request URL. A self-hosted
Convex backend passes a client's `Host` through and builds the request URL from
it, so with a wildcard in `allowedHosts` a client could have a password reset
link point to a host it deployed. And without `trustedProxyHeaders`, the app's
origin from the Next.js and TanStack Start handlers was ignored, since only
`x-forwarded-*` carried it.

The component now sets the request URL, `Host`, `x-forwarded-host` and
`x-forwarded-proto` to one origin on every request, as upstream 0.12.7 does: the
app's origin from `x-better-auth-forwarded-*` (or the incoming `x-forwarded-*`)
when it's an exact trusted origin, else the request's own origin when it's
exactly trusted, else `CONVEX_SITE_URL`, and it removes
`x-better-auth-forwarded-*`. Setting all four gives Better Auth the same origin
whichever header its config reads, as a proxy in front of a direct deploy would.
Removing only the forwarded headers, or telling self-hosted users to add a
reverse proxy, would leave the default Better Auth config exposed. Origins are
still compared in full (protocol and host), from `trustedOrigins`,
`BETTER_AUTH_TRUSTED_ORIGINS` and Better Auth's own trusted origins, and
wildcard entries still don't count, now including `?` patterns, which Better
Auth also treats as wildcards.
