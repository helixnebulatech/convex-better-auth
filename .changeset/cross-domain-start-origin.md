---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: an OAuth sign-in can start from any app listed exactly in
`trustedOrigins`, and the session is handed back to the app that started it.

Until now the session was only handed to `siteUrl`, so a second app on another
origin sharing the same Convex backend couldn't sign in with OAuth. Now:

- `/cross-domain/oauth/start` accepts `siteUrl` and the exact entries of
  `trustedOrigins`, including those returned by a `trustedOrigins` function.
  Wildcard entries such as `https://*.vercel.app` are still rejected.
- The one-time token is only issued when the callback URL is on the origin that
  started the flow, and is still only redeemable by the browser that started it.
- Relative `callbackURL`, `newUserCallbackURL` and `errorCallbackURL` values of
  an OAuth sign-in resolve against the app that started it. Sign-ins from
  `siteUrl`'s origin keep resolving against `siteUrl`, path included.
- Magic links still only hand the session to `siteUrl`.

Why this option: Better Auth keeps the session on the auth server, and its
official plugins only hand it to another web origin when that origin started the
flow in the same browser (`oauth-popup`, `oauth-proxy`). No official plugin
hands a magic link session to another web origin, since anyone can request a
link with any callback URL, so magic links stay on `siteUrl`, your app, as
`expo` only hands them to the app's scheme. Upstream 0.12.6 instead hands the
token to any exact trusted origin in the callback URL, for magic links too,
which goes further than Better Auth does. The plugin stays stricter than
`oauth-popup` in two ways: wildcard origins can't start a flow, and a callback
URL on another origin than the one that started the flow gets no session.
