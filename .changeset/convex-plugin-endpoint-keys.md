---
"@helixnebulatech/convex-better-auth": patch
---

Convex plugin: endpoint keys of its own, so Better Auth's `jwt` and
`oauthProvider` plugins can be used alongside it.

The plugin registered `/convex/token` and `/convex/jwks` under `getToken` and
`getJwks`, the keys of Better Auth's `jwt` plugin, and
`/convex/.well-known/openid-configuration` under `getOpenIdConfig`, the key of
the `oauthProvider` plugin, which requires `jwt`. Better Auth merges plugin
endpoints by key and only warns about shared paths, so the plugin registered
last silently replaced the other's endpoint. With `jwt()` after `convex()`,
`/convex/token` and `/convex/jwks` returned 404 and Convex sign-in stopped
working. With `jwt()` first, its own `/token` and `/jwks` returned 404.

The keys are now `getConvexToken`, `getConvexJwks` and `getConvexOpenIdConfig`
in `auth.api`. The paths don't change, and neither do `getLatestJwks` and
`rotateKeys`. If you called `auth.api.getToken()` to get the Convex JWT on the
server, call `auth.api.getConvexToken()`.

Why this option: Better Auth's official plugins each use endpoint keys of their
own, so plugins don't replace each other. Both plugins keep their keys in the
`jwks` table, and each token verifies against the keys its own plugin publishes.
