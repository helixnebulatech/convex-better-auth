---
"@helixnebulatech/convex-better-auth": patch
---

Fix token issuance and the JWKS endpoint failing when a static JWKS holds
several keys or a key with `expiresAt`
