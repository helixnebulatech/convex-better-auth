---
"@helixnebulatech/convex-better-auth": patch
---

With `jwtCache` enabled, server helpers (`getToken`, `isAuthenticated`,
`fetchAuth*`, `preloadAuthQuery`) now reuse the `convex_jwt` cookie only if its
signature verifies against the deployment's JWKS, with the expected issuer and
audience, and fetch a fresh token otherwise. Previously the cookie was only
decoded. The JWKS is cached per server instance; the new `jwtCache.jwks` option
verifies against a static JWKS without fetching it, and `jwtCache.issuer`
overrides the expected issuer.
