---
"@helixnebulatech/convex-better-auth": patch
---

OpenID configuration: `/convex/.well-known/openid-configuration` still served
the document of Better Auth's removed `oidcProvider` plugin. It advertised
`/oauth2/*` authorization, token, userinfo, registration and end session
endpoints that nothing serves since Better Auth 1.7, and
`id_token_signing_alg_values_supported: ["HS256"]`, while the Convex JWT is
signed with EdDSA or RS256. It now lists what the plugin serves, as upstream
0.13.0 does: `issuer` and `jwks_uri`, which are all Convex reads, plus the
fields OpenID Connect Discovery requires, with the algorithm from your Convex
auth config and the claims every Convex JWT carries. Keeping the old fields
would point OpenID clients at endpoints that 404, and Better Auth's own
discovery document lives in `oauthProvider`, which serves those endpoints.
