---
"@helixnebulatech/convex-better-auth": patch
---

Stop sending `x-forwarded-host` to the Convex site from the Next.js and TanStack Start handlers and `getToken`, which Convex's edge now routes on and answered with an empty 404 for apps on their own domain; the app host still reaches Better Auth via `x-better-auth-forwarded-host`.
