---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: tie OAuth sign-in and account linking to the browser that started
them, as Better Auth does. `crossDomainClient` now starts the redirect through
the Convex site, which sets the OAuth state cookie, and the callback checks it
again. The one-time token from an OAuth sign-in can only be redeemed by the
browser that started it, and one-time tokens are only handed to `siteUrl`.

Deploy your Convex backend and your frontend together: an old client can't
complete an OAuth sign-in against the new server, and the other way round. Users
with the app already open need to reload it before signing in with an OAuth
provider. Email, magic link, OTP and existing sessions aren't affected. If you
pass `disableRedirect: true` and open the provider URL yourself, the callback
now fails the state check, as it does with Better Auth on a single domain.
