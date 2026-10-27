---
"@helixnebulatech/convex-better-auth": patch
---

Convex plugin: sign the Convex JWT only where Better Auth's `jwt` plugin signs,
never on sign-in. Fixes a two-factor bypass when `convex()` is listed before
`twoFactor()`.

The plugin signed the JWT in an after hook on every sign-in path and stored it
in the `convex_jwt` cookie. Better Auth runs plugin hooks in plugin order, so
with `convex()` before `twoFactor()` it signed for the new session before
`twoFactor` cancelled it to ask for the second factor. The sign-in response then
carried a valid JWT, and anyone with only the password could call Convex
functions that rely on `ctx.auth.getUserIdentity()` until it expired (15 minutes
by default). With `twoFactor()` first, the order in the examples, no JWT was
set.

Now the JWT is signed only by `/convex/token`, which requires a session, and
after `/get-session` returns one, as Better Auth's `jwt` plugin does with
`/token` and its `/get-session` hook. Also:

- `/get-session` signs from the session it returns. It no longer signs for an
  expired session, which Better Auth deletes and answers with `null`, and it
  clears the cookie then.
- Sign-in, sign-up and any other request that starts a new session clear the
  `convex_jwt` cookie, so a JWT of a previous session in the same browser isn't
  reused by server-side rendering with `jwtCache`.
- The hook no longer calls the token endpoint with empty headers, which logged
  `INTERNAL_SERVER_ERROR` on sign-ins that didn't create a session.

After a sign-in, the cookie is set by the first `/get-session` call, which the
client makes right away. Server-side helpers without the cookie fetch the token
from `/convex/token`, as they already did.

Why this option: Better Auth's `jwt` plugin never signs on sign-in, only from a
session that `/token` or `/get-session` has checked. Signing on sign-in can't be
made safe by plugin order alone, since nothing enforces it. Clearing the cookie
when a new session starts is stricter than Better Auth, which has no JWT cookie.
