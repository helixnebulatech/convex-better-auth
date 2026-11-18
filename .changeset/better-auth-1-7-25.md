---
"@helixnebulatech/convex-better-auth": minor
---

The `better-auth` peer range is now `>=1.7.25 <1.8.0`, up from `>=1.7.18`.
Install `better-auth@~1.7.25`, and the same version of any `@better-auth/*`
package. Better Auth versions below 1.7.25 aren't supported, and package
managers that enforce peer ranges (npm without `legacy-peer-deps`, pnpm with
strict peer dependencies) reject the install with them. This is a minor release
because of that floor and the CORS change below; the component functions, the
schema and the options don't change. See the
[0.14 migration guide](https://github.com/helixnebulatech/convex-better-auth/blob/main/docs/content/docs/migrations/migrate-to-0-14.mdx).

**CORS keeps the headers Better Auth exposes.** With `cors`, `registerRoutes`
and `registerRoutesLazy` replaced `Access-Control-Expose-Headers` with their own
list (`Set-Better-Auth-Cookie` and `cors.exposedHeaders`), because the
convex-helpers CORS router overwrites the header. Cross-origin clients couldn't
read the headers Better Auth and its plugins expose themselves:
`WWW-Authenticate` on `oauthProvider` 401 challenges (exposed since Better Auth
1.7.23, whose release notes ask CORS layers to keep it), `set-auth-token` from
`bearer`, `set-auth-jwt` from `jwt` and `set-ott` from `oneTimeToken`. The
routes now add their headers to the list Better Auth set, comparing names
without regard to case. That's what Better Auth does: its endpoint dispatcher
(1.7.25) and `oauthProvider` merge the list the same way, and `bearer`, `jwt`
and `oneTimeToken` add to it, while no official package replaces it. Merging was
chosen over adding `WWW-Authenticate` to the default list, which would fix one
header and hide the next one a plugin exposes. Only the origins in
`trustedOrigins` and `cors.allowedOrigins` get `Access-Control-Allow-Origin`, so
no other origin can read more than before. The `convex` plugin only uses
`bearer` to read the `Authorization` header, so the session token is exposed
only when an app adds `bearer` itself. The security notes and the Hono guide,
whose `cors` middleware also replaces the header, explain what to expose in your
own CORS layer.

**Tested with Better Auth 1.7.19 to 1.7.25.** The release notes were checked
against the component, and nothing else needed a change:

- Verification values (password reset, email OTP, magic link, phone and two
  factor OTP) are consumed by deleting the identifier's older rows with `id ne`
  and `createdAt lte` (1.7.22). Upstream's adapter rejected that where clause
  (get-convex/better-auth#481); the fork's already handled it, and new tests
  cover `findMany`, `deleteMany` and `consumeVerificationValue` with it.
- `update` changes one row and `updateMany` every match (1.7.21), as the adapter
  already did.
- `ne null` doesn't match unset fields (1.7.20), as the adapter already did.
- `json` fields hold arrays (1.7.23): the new adapter test passes.
- Revoking the current session, or deleting the user with a token, expires the
  session cookie (1.7.22), and the Convex JWT cookie is cleared with it, as on
  sign-out. New tests cover `/revoke-session` and `/revoke-sessions`.
- `getSession` clears an expired session from the request context (1.7.22). The
  `convex` plugin reads the response, not the context.
- `oauthProvider` writes client `metadata` as an object (1.7.19). The adapter
  stores `json` fields as strings and reads both forms back.
- SCIM returns 501 on adapters without native transactions instead of failing at
  startup (1.7.21). It still can't be used on Convex.
- The component schema generated with `auth@1.7.25` is the same as with 1.7.18.

Every dependency is on its latest release that is at least 3 days old: Convex
1.50, convex-helpers 0.1.135, jose 6.2.17, convex-test 0.0.71, Ultracite 8.2.1
and oxlint 1.93, among others. CI and the release workflow move to Node 26, the
current LTS, with `@types/node` 26. npm 11.20, bundled with Node 26, still meets
Trusted Publishing's npm 11.5.1 minimum.
