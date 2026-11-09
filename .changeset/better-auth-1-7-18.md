---
"@helixnebulatech/convex-better-auth": patch
---

The `better-auth` peer range is now `>=1.7.18 <1.8.0`, up from `>=1.7.16`.
Better Auth 1.7.17 and 1.7.18 fix bugs that affect Convex apps: two factor with
API key sessions and trusted devices on custom sign-in paths, revoked sessions
from the cookie cache when denying a device authorization, the `dont_remember`
cookie keeping remembered sessions from refreshing, and empty phone numbers. The
component code doesn't change, and its tests pass on 1.7.18. Raising the floor
instead of only testing with 1.7.18 means apps get those fixes, as 0.13.9 did
for 1.7.16. Apps on 1.7.16 or 1.7.17 must upgrade it with this release, or npm
(and pnpm with strict peer dependencies) refuses the install:
`better-auth@~1.7.18`.

The security notes now cover `auth.api` calls from Convex functions. Like Better
Auth, they skip the origin and CSRF checks and the `trustedOrigins` check of
`callbackURL`, `errorCallbackURL`, `newUserCallbackURL` and `redirectTo`, so
functions that take one of those URLs as an argument must validate it. The notes
explain why the bearer token from `getHeaders` doesn't need an origin check.
