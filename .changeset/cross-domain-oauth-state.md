---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: tie OAuth sign-in and account linking to the browser that started
them, as Better Auth does. `crossDomainClient` now starts the redirect through
the Convex site, which sets the OAuth state cookie, and the callback checks it
again. The one-time token from an OAuth sign-in can only be redeemed by the
browser that started it, and one-time tokens are only handed to `siteUrl`.
Update the server and client together.
