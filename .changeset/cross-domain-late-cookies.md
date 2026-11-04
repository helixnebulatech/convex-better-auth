---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: cookies set by plugins listed after `crossDomain` reach the
client. The plugin moved `Set-Cookie` into `Set-Better-Auth-Cookie` in an after
hook, and Better Auth runs after hooks in plugin order, so a later hook's
cookies went out as plain `Set-Cookie`, which the cross domain client never
reads. With `twoFactor` after `crossDomain`, the client got the held session's
token but not the `two_factor` cookie, so the second factor couldn't be
verified, and with the Convex plugin before `crossDomain`, the expiry of the
previous user's `convex_jwt` was lost.

The after hook still moves the cookies set so far, so `auth.api` callers see the
same headers as before, and marks the response. The plugin's `onResponse`, which
Better Auth runs after every after hook, moves the rest and removes the mark. No
official Better Auth plugin uses `onResponse`, so returning a new response there
doesn't skip another plugin's. Documenting a required plugin order instead would
leave apps that list `twoFactor` after it, as the docs' examples add plugins,
broken. Upstream has the same bug. The Convex plugin also reads
`Set-Better-Auth-Cookie` when it checks whether a response expires the session
cookie.
