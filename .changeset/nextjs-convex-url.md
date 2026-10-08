---
"@helixnebulatech/convex-better-auth": patch
---

Use the `convexUrl` passed to `convexBetterAuthNextJs` in `preloadAuthQuery`, `fetchAuthQuery`, `fetchAuthMutation` and `fetchAuthAction` instead of always falling back to `NEXT_PUBLIC_CONVEX_URL`.
