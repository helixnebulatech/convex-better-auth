---
"@helixnebulatech/convex-better-auth": patch
---

`ConvexBetterAuthProvider` no longer drops Convex auth when an SSR session hydrates, no longer reuses the SSR token after sign-out or for a different session, and now caches fetched tokens.
