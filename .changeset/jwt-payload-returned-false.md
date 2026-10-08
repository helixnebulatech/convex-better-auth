---
"@helixnebulatech/convex-better-auth": patch
---

The Convex JWT set as a cookie on sign-in and sign-up no longer includes user
and session fields marked `returned: false`, matching the token from
`/convex/token` and Better Auth's `jwt` plugin.
