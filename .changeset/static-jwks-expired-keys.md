---
"@helixnebulatech/convex-better-auth": patch
---

Static JWKS: drop expired keys, as Better Auth's JWKS endpoint does.

With a static `JWKS`, the public key set for the Convex auth config and for
`jwtCache` verification kept every key, so a key past its `expiresAt` was
accepted forever. Keys past `expiresAt` plus the 30-day grace period are now
left out, as `/convex/jwks` and Better Auth's `/jwks` already do. For the Convex
auth config this is evaluated when you deploy.
