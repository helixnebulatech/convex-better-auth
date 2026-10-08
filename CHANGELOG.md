# Changelog

## 0.13.3

### Patch Changes

- ebc196a: Cross domain: tie OAuth sign-in and account linking to the browser
  that started them, as Better Auth does. `crossDomainClient` now starts the
  redirect through the Convex site, which sets the OAuth state cookie, and the
  callback checks it, as Better Auth does. The one-time token from an OAuth
  sign-in can only be redeemed by the browser that started it, and one-time
  tokens are only handed to `siteUrl`.

  Deploy your Convex backend and your frontend together: an old client can't
  complete an OAuth sign-in against the new server, and the other way round.
  Users with the app already open need to reload it before signing in with an
  OAuth provider. Email, magic link, OTP and existing sessions aren't affected.
  If you pass `disableRedirect: true`, start the redirect with the new
  `authClient.startOAuthRedirect(data.url)` instead of opening the URL yourself.

  Like Better Auth, OAuth is only started for requests that carry your app's
  origin. Apps with a referrer policy that hides it, such as `no-referrer` (the
  default of `helmet`), get a `missing_or_null_origin` error: change the policy,
  or pass the new `setReferrerPolicy: true` option to `crossDomainClient`. See
  the React guide.

- 0f6dcd6: `jwtCache.expirationToleranceSeconds` now refreshes the cookie JWT
  that many seconds before it expires, as intended. It used to keep reusing a
  JWT for up to that long after it had expired.
- c877ca1: The Convex JWT set as a cookie on sign-in and sign-up no longer
  includes user and session fields marked `returned: false`, matching the token
  from `/convex/token` and Better Auth's `jwt` plugin.
- a62606c: `verbose: true` no longer logs credentials from request and response
  headers: `Cookie`, `Authorization`, `Set-Cookie`, `Better-Auth-Cookie`,
  `Set-Better-Auth-Cookie`, `Set-Auth-Token`, `Set-Auth-JWT` and `X-Api-Key` are
  redacted, redirect `Location` headers are logged without their query string,
  which can carry one-time tokens, and the CORS router's debug output, which
  logged raw headers, is no longer enabled. `verbose` still turns on Better
  Auth's adapter `debugLogs`, which are unchanged and log full rows, as
  documented on the Debugging page.
- a00abbc: Compare null the way Better Auth's SQL adapters do. `lt`, `lte`,
  `gt`, `gte`, `ne` and `not_in` no longer match documents where the field is
  null or unset, and a range comparison against `null` matches nothing. Before,
  Convex's ordering (null and unset below every value) made, for example,
  `expiresAt lt now` also match documents without an `expiresAt`, so
  `deleteMany` could delete them, and the two factor plugin's lock reset could
  match an already cleared lock. `eq null` and `ne null` keep matching null and
  unset fields (`IS NULL`, `IS NOT NULL`).
- 0f6dcd6: With `jwtCache` enabled, server helpers (`getToken`,
  `isAuthenticated`, `fetchAuth*`, `preloadAuthQuery`) now reuse the
  `convex_jwt` cookie only if its signature verifies against the deployment's
  JWKS, with the expected issuer and audience, and fetch a fresh token
  otherwise. Previously the cookie was only decoded. The JWKS is cached per
  server instance; the new `jwtCache.jwks` option verifies against a static JWKS
  without fetching it, and `jwtCache.issuer` overrides the expected issuer.

  In the Next.js helpers, `isAuthenticated()` no longer uses the cached JWT at
  all: it checks the session with the server, like Better Auth's `getSession`,
  so it turns `false` right after sign-out.

## 0.13.2

### Patch Changes

- 47911e8: Apply AND where clauses combined with OR clauses in `findOne`,
  `findMany`, `count`, `updateMany` and `deleteMany` instead of dropping them,
  and return null from `findOne` when no OR clause matches
- e685de9: Cross domain: stop logging "No session found" on callbacks that don't
  create a session, like linkSocial and error redirects.
- 0ecc487: Stop sending `x-forwarded-host` to the Convex site from the Next.js
  and TanStack Start handlers and `getToken`, which Convex's edge briefly routed
  on in August 2026, answering every auth request from apps on their own domain
  with an empty 404; the app host still reaches Better Auth via
  `x-better-auth-forwarded-host`.
- 57883af: Support `offset` in `findMany`, so paging such as the admin plugin's
  `listUsers` and the organization plugin's `listMembers` no longer fails (admin
  `listUsers` returned an empty list)
- 6645b34: With `jwtCache` enabled, server helpers now retry with a fresh token
  when Convex rejects the cookie JWT, and no longer re-run calls that failed for
  other reasons.
- f9caf76: Require the latest versions of the runtime dependencies:
  `@better-fetch/fetch` ^1.3.2, `convex-helpers` ^0.1.124, `jose` ^6.2.12,
  `remeda` ^2.50.0, `semver` ^7.8.5, `type-fest` ^5.10.0 and `zod` ^4.6.5.
- 4a9de46: Match optional fields that were never written against `eq null` /
  `ne null` where clauses, so Better Auth atomic updates such as the two factor
  lockout no longer fail on them
- 39fbedf: Use the `convexUrl` passed to `convexBetterAuthNextJs` in
  `preloadAuthQuery`, `fetchAuthQuery`, `fetchAuthMutation` and
  `fetchAuthAction` instead of always falling back to `NEXT_PUBLIC_CONVEX_URL`.
- 9f171b0: Type `usePreloadedAuthQuery` as returning `undefined` (not `null`)
  when there is no result, matching what it returns at runtime and `useQuery`.
- 098e03b: `ConvexBetterAuthProvider` no longer drops Convex auth when an SSR
  session hydrates, no longer reuses the SSR token after sign-out or for a
  different session, and now caches fetched tokens.
- e7b2227: Strip hop-by-hop headers such as `connection: keep-alive` from
  proxied auth responses in the Next.js and TanStack Start handlers, fixing
  empty 400 responses for clients that send `Connection: close`.
- 2ad2005: Add a `lastRequest` index to the `rateLimit` table so pruning expired
  rate limit rows no longer scans the whole table. Local installs pick it up by
  regenerating their schema.
- 8e201f8: Treat an `id` where clause holding an id from another model as no
  match, instead of returning that other model's document
- 4d1d8e6: Fix token issuance and the JWKS endpoint failing when a static JWKS
  holds several keys or a key with `expiresAt`
- 9a8a6ce: Enforce unique constraints on renamed fields and on Better Auth
  table-level unique indexes (such as device authorization codes), and generate
  schema indexes for table-level indexes.
- 7fd4ddb: Look up sessions by a list of tokens through the token index instead
  of scanning the session table, as the multi-session plugin does when listing
  device sessions.

## 0.13.1

### Patch Changes

- a9a711c: Publish from GitHub Actions with npm provenance

## 0.13.0

- feat!: update to better-auth 1.7.5, minimum 1.7.5 (see the
  [0.13 migration guide](./docs/content/docs/migrations/migrate-to-0-13.mdx))
- fix relative `--output` path in generated schema header
- support better-auth 1.7.6+: strip `modelKey` before calling component
  functions
- implement `consumeOne` natively, Better Auth's fallback broke verification
  consumption (magic link, email OTP, one-time token, cross domain)
- no-op `consumeOne` and `incrementOne` in query context

## 0.12.5

- fix unbounded count/findMany pagination looping forever past 200 rows (#394)

## 0.12.4

- use ActionCtx for runMutation for now (#390)
- fix cross-domain client plugin types (#391) @zbeyens

## 0.12.3

- update to better-auth 1.6.15, minimum 1.6.11 (#388)

## 0.12.2

- fix: strip hop-by-hop headers in framework proxy handlers (#360) @CipherSight
- fix: pass through trigger results from create/update (#358)

## 0.12.1

- fix: set correct Host header in getToken (#348) @zougari47
- fix: preserve 2FA cookie in crossDomain plugin (#325) @rit3sh-x
- move adapter test registration out of t.action() into module scope (#351)

## 0.12.0

- feat: support Better Auth 1.6.9+ (#323) @ramonclaudio
- feat: allow setting basePath for getToken (#308) @amosbastian

## 0.11.5

- Preserve and restore forwarded host headers in framework adapters (#327)
  @mmailaender

## 0.11.4

- fix: accept BaseURLConfig type for baseURL option (#310)

## 0.11.3

- Lazy route registration for reduced memory usage (#302)

## 0.11.2

- fix: return dates as numbers from customTransformOutput (#298)
- fix(adapter): match composite index fields by real names (#297)

## 0.11.1

- chore: add missing generated types

## 0.11.0

- fix: prevent proxy compression from breaking server-side token fetch (#295)
- feat: migrate to Better Auth 1.5 (#292) @wiesson @onmax

## 0.10.13

- fix: add optional chaining for ctx.path in crossDomain before-hooks (#279)
- fix(package): remove spurious react-dom peer dependency (#278) @ramonclaudio

## 0.10.12

- fix(cross-domain): don't inject callbackURL when not provided (#276)
- fix(cross-domain): only notify session signal when token value changes (#273)
- fix: skip session refresh/delete in query context for all paths (#272)
- fix(react): handle missing window.location in React Native (#270)
- fix(cross-domain): only rewrite set-cookie for cross-domain requests (#269)
- fix(react): deduplicate concurrent fetchAccessToken calls (#267) @ramonclaudio
- fix: Better Auth schema model lookup (#231) @potrepka

## 0.10.11

- fix: stale credentials and incorrect auth state after session expiry (#218)
  @ramonclaudio
- fix(react): use initialToken on first render for SSR hydration (#223)
  @nilskroe
- fix(adapter): return Date objects from customTransformOutput (#236) @tomsiwik
- fix(react): pass throw: false to internal token fetch (#241) @juliesaia
- fix: prevent request hanging in Bun by selectively forwarding headers (#253)
  @shrutikcs
- fix: add optional chaining to ctx.path (#256) @bitojoe
- fix: widen better-auth peer dependency to >=1.4.9 <1.5.0 (#245) @ramonclaudio

## 0.10.10

- fix(cross-domain): only notify session signal on session cookie set

## 0.10.9

- fix(adapter): hide vitest imports from esbuild

## 0.10.8

- fix(adapter): avoid vitest import errors in bundle

## 0.10.7

- feat: use better-auth/minimal for smaller bundle
- feat: update to better-auth 1.4.9
- chore: drop extra logs, enforce via lint
- fix: use correct host header format in framework route handlers

## 0.10.6

- fix(adapter): (re-)enable array support

## 0.10.5

- fix(plugin): avoid pathless route match errors

## 0.10.4

- fix(build): use outside type imports to avoid dead code in builds

## 0.10.3

- fix(build): enforce type imports, tsc does not tree shake

## 0.10.2

- fix(build): exclude cross-domain server plugin from client bundle

## 0.10.1

- fix: make transient dependencies explicit

## 0.10.0

- feat: support Better Auth 1.4.7
- feat: faster JWT validation for authenticated server calls using customJwt
- feat: default auth configuration provided through utility function
- feat: authenticated server utilities for TanStack Start and Next.js
  (fetchAuthQuery, etc.)
- feat: improved SSR support with patterns to prevent server data dropping
  during client auth
- feat: Next.js works without expectAuth for seamless rendering
- feat: simplified session validation with authComponent.getAuthUser()
- feat: initial token support in ConvexBetterAuthProvider for faster client
  initialization
- feat: explicit Convex URL configuration with runtime checks to reduce
  environment variable issues
- feat: remove optionsOnly complexity in createAuth()
- feat(experimental): static JWKS support to reduce Convex backend token
  validation time
- feat(experimental): JWT caching to speed page loads and navigation for SSR

## 0.9.11

- fix: drop stray troubleshooting logs

## 0.9.10

- fix: support custom schema type in createClient

## 0.9.9

- fix: update import extensions for esm resolution

## 0.9.8

- chore: update to latest component authoring guidelines and tooling

## 0.9.7

- fix: add type error for triggers without authFunctions
- fix: support Better Auth options inference through getStaticAuth
- fix(tanstack): add improved tanstack integration methods

## 0.9.6

- fix: swap oldDoc/newDoc onUpdate in types
- fix(adapter): add json field schema support
- fix(adapter: support custom field names in schema generation
- fix(adapter): support custom table names in schema generation

## 0.9.5

- fix(cross-domain): remove extra logs

## 0.9.4

- fix: move semver dependency to dependencies'

## 0.9.3

- fix: allow authorization header for cors by default

## 0.9.2

- feat(convex-plugin): set token cookie on siwe verify response

## 0.9.1

- fix(convex-plugin): correctly parse cookie for ssa jwt token

## 0.9.0

- feat: add getAuth component method
- chore: support Better Auth 1.3.27
- feat: update helpers, docs, and examples for latest TanStack RC
- docs: add migration guides for dropping user.userId field
- fix: reference session by token from jwt in getHeaders
- docs: add api docs for a few of the more often used methods
- fix: block stale session delete for get-session client calls
- feat: add requireRunMutationCtx and requireActionCtx type utils
- fix: swap old and new doc params in onUpdate trigger

  This was just a mistake in design - you often will not need the old doc in an
  update trigger, so it should be a trailing param

  BREAKING CHANGE: 2nd and 3rd params in onUpdate trigger are swapped

## 0.8.9

- fix(react): fix overreacting fetch token hook

## 0.8.8

- fix: use correct session field for getHeaders query

## 0.8.7

- fix: use jwt session id for getHeaders state
- fix: ensure jwt updates when session changes
- feat: support using cross-domain plugin with expo web

## 0.8.6

- fix(react-start): fix TanStack utility types

## 0.8.5

- fix(react-start): get setupFetchClient getCookie through args
- feat: add authComponent.getAnyUserById method

## 0.8.4

- fix: fix createAuth types in framework helpers
- feat: improve ctx types passed to createAuth

## 0.8.3

- fix: use correct type for getAuthUser ctx

## 0.8.2

- fix: error if generating component schema in app convex directory
- fix: fix esbuild error due to node import in createSchema
- fix: support disabling logging for static auth instances

## 0.8.1

- fix(tanstack): drop getAuth, update docs to implement locally
- fix: always return a headers object from getHeaders
- fix: use correct signature for onUpdate trigger

## 0.8.0

- docs: rewrite docs
- feat: support local install, improve unrelated apis
- fix(adapter): apply all where clauses for compound queries
- fix: support session type inference in client
- fix: log error on invalid table name
- feat: support additionalFields options for user table
- fix: use options basePath for oidc discovery redirect
- feat: add `getUserByUsername` component method
- fix: return application userId for reference fields
- fix: use correct package exports for client plugins

## 0.7.18

- chore: upgrade to Better Auth 1.3.8

## 0.7.17

- fix: disable telemetry by default

## 0.7.16

- chore: upgrade to Better Auth 1.3.7

## 0.7.15

- fix: add missing return types to component methods

## 0.7.14

- fix: update jwks_uri to include options basePath

## 0.7.13

- fix: support auth.api calls without headers

## 0.7.12

- warn on secure cookie mismatch between Convex and Next.js
- maintain dropped fields in Better Auth schema to avoid breaking deploys
- support Better Auth 1.3.4

## 0.7.11

- fix build output type errors, simplify watch task
- fix TanStack helper docs, throw on invalid env vars

## 0.7.10

- fix: support inferring user/session schema changes from plugins
- fix: remove redundant auth check in getCurrentSession

## 0.7.9

- Add context type guards to utils.

## 0.7.8

- Add `updateUserMetadata` method to the client (undocumented, may change or be
  removed).

## 0.7.7

- generate admin plugin schema

## 0.7.5

- fix: roll back trusted origins breaking change for cors

## 0.7.4

- feat: allow `registerRoutes` to be called with a `cors` config object

## 0.7.3

- fix: fail to push on invalid Convex version

## 0.7.2

- fix: add Convex version requirement to docs and package.json.

## 0.7.1

- fix: serialize output date values in the adapter.

## 0.7.0

- Pass all Better Auth adapter tests.

- Convert adapter to fully dynamic queries and mutations.

- Add schema generation for component schema.

- Support multiple `registerRoutes` calls.

- Fix email verification redirect.
- Support `trustedOrigins` as a function.

- Simplify CORS handling and make it optional.

  Adds a new `cors` option to the `registerRoutes` method, currently accepts a
  boolean to enable CORS routes and headers.

  The `path` and `allowedOrigins` options have been removed from the
  `registerRoutes` method, they now defer to Better Auth's `basePath` and
  `trustedOrigins` options, respectively. The `siteUrl` option for the
  crossDomain plugin continues to be automatically added to `trustedOrigins`.

- Support `listSessions` method.

- Set jwt cookie at login for SSA.

  Without this the cookie wasn't set until the first authenticated client load,
  making SSA fail when loading the next route after login.

- Delete expired sessions at login. This will help with sessions piling up in
  the database, but doesn't completely solve it, especially for apps with very
  long lived sessions and lots of users.

## 0.6.2

- Fix email verification callback URL rewriting in the crossDomain plugin.
