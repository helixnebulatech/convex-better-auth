---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: hand the session created by email verification to the app at
`siteUrl`.

With `autoSignInAfterVerification`, and when confirming an email change, Better
Auth creates a session for whoever opens the verification link and sets it as a
cookie of the auth server. With the cross domain plugin that cookie is on your
Convex site, so the user reached the app signed out and the session was left
unused. Opening the link now redirects with a one-time token, like a magic link.

Why this option: Better Auth's `expo` plugin hands the session from
`/verify-email` to the app, as it does for magic links and OAuth callbacks, and
only to the app's own scheme, never to another web origin. Verification links
are sent by email and can be requested with any trusted callback URL, so, like
magic links, the token only goes to `siteUrl` and isn't tied to a browser.
