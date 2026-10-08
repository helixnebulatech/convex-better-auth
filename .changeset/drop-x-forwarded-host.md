---
"@helixnebulatech/convex-better-auth": patch
---

Stop sending `x-forwarded-host` to the Convex site from the Next.js and TanStack Start handlers and `getToken`, which Convex's edge briefly routed on in August 2026, answering every auth request from apps on their own domain with an empty 404; the app host still reaches Better Auth via `x-better-auth-forwarded-host`.
