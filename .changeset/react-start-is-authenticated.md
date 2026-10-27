---
"@helixnebulatech/convex-better-auth": patch
---

TanStack Start: add `isAuthenticated()`, which checks the session with the
server.

The JWT caching docs said `isAuthenticated()` always checks the session, but
only the Next.js helpers had it. In TanStack Start, `getToken()` returns the JWT
cached in the `convex_jwt` cookie when `jwtCache` is enabled, which stays valid
after the session ends. `convexBetterAuthReactStart` now returns
`isAuthenticated()`, which always fetches a fresh token, as the Next.js helper
does and as Better Auth's `getSession` checks the session.
