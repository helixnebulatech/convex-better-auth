---
"@helixnebulatech/convex-better-auth": patch
---

Merge upstream 0.12.6. The forwarded host is only restored for exact trusted
origins (GHSA-pgx2-m66h-x29f).

The framework handlers send the app's host and protocol in
`x-better-auth-forwarded-host` and `x-better-auth-forwarded-proto`, and anyone
can call the Convex site with these headers. The component used to copy them to
`x-forwarded-host` and `x-forwarded-proto` unconditionally. Now it copies them
only when together they form an origin listed exactly in `trustedOrigins`,
`BETTER_AUTH_TRUSTED_ORIGINS` or the `allowedHosts` of a dynamic `baseURL`.
Wildcard entries don't count, and both headers are restored or neither is. The
Next.js and TanStack Start handlers no longer send `x-forwarded-proto` to
Convex.

This only matters for apps with `advanced.trustedProxyHeaders` enabled, since
Better Auth ignores `x-forwarded-*` otherwise. If such an app relied on a
wildcard host for links in emails, list the hosts exactly or set `SITE_URL` per
preview deployment.

Also from upstream: `register` in `@convex-dev/better-auth/test` returns the
component API, `convex-helpers` ^0.1.128, and the SvelteKit guide targets
SvelteKit 3. The cross domain fix in 0.12.6 (GHSA-j8qq-g9pm-v3c2) is already
covered by 0.13.3, which only hands one-time tokens to `siteUrl`.
