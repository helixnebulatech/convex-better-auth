---
"@helixnebulatech/convex-better-auth": patch
---

Convex JWT cookie: with `twoFactor` before `convex` in `plugins`, a sign-in held
for the second factor left the `convex_jwt` cookie of the user signed in before
in the same browser in place, for up to 15 minutes. The plugin cleared it on
sign-out and when `ctx.context.newSession` was set, but `twoFactor`'s after hook
expires the session cookie and sets `newSession` to `null` before a later
plugin's hook runs. The cookie is now also cleared whenever the response expires
the session cookie, the way Better Auth's `deleteSessionCookie` clears the
cookies derived from the session (`session_data`, `account_data`). Upstream
lists sign-in paths instead; following the session cookie also covers paths a
list misses, such as other plugins that cancel or end a session, and doesn't
depend on the plugin order.
