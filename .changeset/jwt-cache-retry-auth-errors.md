---
"@helixnebulatech/convex-better-auth": patch
---

With `jwtCache` enabled, server helpers now retry with a fresh token when Convex rejects the cookie JWT, and no longer re-run calls that failed for other reasons.
