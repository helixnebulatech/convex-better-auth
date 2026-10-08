---
"@helixnebulatech/convex-better-auth": patch
---

`jwtCache.expirationToleranceSeconds` now refreshes the cookie JWT that many
seconds before it expires, as intended. It used to keep reusing a JWT for up to
that long after it had expired.
