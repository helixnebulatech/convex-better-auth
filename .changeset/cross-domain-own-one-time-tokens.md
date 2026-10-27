---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: the one-time token has its own endpoint key and storage, so Better
Auth's `oneTimeToken` plugin can be used alongside it.

The cross domain plugin registered its verify endpoint under
`verifyOneTimeToken`, the same key as Better Auth's `oneTimeToken` plugin, and
stored its tokens as `one-time-token:<token>`, like that plugin. Better Auth
merges plugin endpoints by key and only warns about shared paths, so with both
plugins the one registered last silently replaced the other's verify endpoint:

- With `oneTimeToken()` after `crossDomain()`,
  `/cross-domain/one-time-token/verify` returned 404, so cross domain sign-in
  failed, and `/one-time-token/verify` redeemed an OAuth one-time token without
  the verifier of the browser that started the flow (with the default
  `storeToken: "plain"`).
- With `oneTimeToken()` first, `/one-time-token/verify` returned 404.

The endpoints are now `crossDomainOAuthStart` and
`crossDomainVerifyOneTimeToken` in `auth.api`, the paths and the client don't
change. Tokens are stored as `cross-domain-ott:<token>` and redeemed by the
plugin itself, with the same steps as the `oneTimeToken` plugin, except that an
expired session is rejected before its cookie is set. A token issued in the 3
minutes before the upgrade can't be redeemed after it, and the user has to sign
in again.

Why this option: Better Auth's official plugins each use endpoint keys and
verification identifiers of their own (`magicLinkVerify`, `oauthPopupStart`), so
plugins don't replace each other. Tokens issued before the upgrade aren't
accepted under the old prefix, since that would let the cross domain endpoint
redeem tokens of the `oneTimeToken` plugin.
