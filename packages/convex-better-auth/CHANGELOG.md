# Changelog

## 0.13.10

### Patch Changes

- [#22](https://github.com/helixnebulatech/convex-better-auth/pull/22) [`224e828`](https://github.com/helixnebulatech/convex-better-auth/commit/224e828b96a05aec55fea7f9f065c23b732a6210) Thanks [@helixnebulatech](https://github.com/helixnebulatech)! - The `better-auth` peer range is now `>=1.7.18 <1.8.0`, up from `>=1.7.16`.
  Better Auth 1.7.17 and 1.7.18 fix bugs that affect Convex apps: two factor with
  API key sessions and trusted devices on custom sign-in paths, revoked sessions
  from the cookie cache when denying a device authorization, the `dont_remember`
  cookie keeping remembered sessions from refreshing, and empty phone numbers. The
  component code doesn't change, and its tests pass on 1.7.18. Raising the floor
  instead of only testing with 1.7.18 means apps get those fixes, as 0.13.9 did
  for 1.7.16. Apps on 1.7.16 or 1.7.17 must upgrade it with this release, or npm
  (and pnpm with strict peer dependencies) refuses the install:
  `better-auth@~1.7.18`.
  
  The security notes now cover `auth.api` calls from Convex functions. Like Better
  Auth, they skip the origin and CSRF checks and the `trustedOrigins` check of
  `callbackURL`, `errorCallbackURL`, `newUserCallbackURL` and `redirectTo`, so
  functions that take one of those URLs as an argument must validate it. The notes
  explain why the bearer token from `getHeaders` doesn't need an origin check.

- [#23](https://github.com/helixnebulatech/convex-better-auth/pull/23) [`94dcc7d`](https://github.com/helixnebulatech/convex-better-auth/commit/94dcc7d45552e7f9d94b0ee6a7c56d0c06984ab8) Thanks [@helixnebulatech](https://github.com/helixnebulatech)! - The repository now follows the layout of the Vercel AI SDK and of
  better-auth-dbsc: a Bun workspace with the package in
  `packages/convex-better-auth`, built with tsdown and linted and formatted with
  Ultracite (oxlint and oxfmt) instead of ESLint and Prettier. The published files
  are the same as in 0.13.9, one module per file as before, plus `CHANGELOG.md`.
  tsdown keeps one output file per module because Convex bundles the component
  from the files next to `dist/component/convex.config.js`.
  
  Two adapter errors are now `TypeError`s, still `instanceof Error`: incrementing
  a non-numeric field, and an `in` clause whose value isn't an array. The ESLint
  rules the package had, including Convex's own and `no-floating-promises`, run in
  oxlint; Ultracite's style-only rules are off so upstream merges stay small.

## 0.13.9

### Patch Changes

- 325ae73: Adapter: an account can't be created or updated with the `providerId`
  and `accountId` of another account. Better Auth checks for an existing account
  before linking one, but two requests racing to link the same provider account
  could both pass the check and create two rows. From then on, Better Auth's
  internal adapter (`findAccountByKey`, `findAccountOwnerByKey`) throws
  "Multiple accounts match the same accountId" and the user can't sign in with
  that provider. The component now checks the pair as a unique constraint, in
  the same mutation as the write, with the `accountId_providerId` index, the
  same way it checks Better Auth's unique fields, so `create`, `update`,
  `updateMany` and `incrementOne` all enforce it, and a renamed `accountId` or
  `providerId` field is covered. This is stricter than Better Auth's SQL schema,
  which declares no constraint for the pair, as allowed where Better Auth itself
  breaks on duplicates. Upstream checks only on create; checking on update too
  keeps an update from producing the same duplicate.
- 325ae73: Adapter: native `incrementOne`, and `consumeOne` and `incrementOne`
  component functions in `createApi`, with upstream's arguments. Better Auth 1.7
  updates rate limit rows, two factor lockouts and organization team seats with
  `incrementOne`. Without a native one, Better Auth reads the row and updates it
  with a compare-and-swap `updateMany`, retried 5 times, so concurrent requests
  on the same row could fail with "could not complete an atomic increment due to
  contention". The component's `incrementOne` reads, checks and writes the row
  in one mutation, which Convex runs as a transaction, as Better Auth's Kysely
  adapter does in one `UPDATE ... WHERE`. An unset or null counter counts as 0,
  as in Better Auth's memory adapter and atomic fallback (SQL would leave it
  null), and the `where` keeps the SQL null semantics of every other query, so a
  guard like `count lt 5` never matches a null count; upstream needs extra
  `ne null` guards for that, ours doesn't.

  The client adapter keeps consuming rows with `deleteOne`, which finds and
  deletes the row in one mutation too, so it's as atomic as the new `consumeOne`
  and keeps working with every Local Install. For `incrementOne` there is no
  existing function to fall back on, so when a Local Install's `adapter.ts`
  doesn't export it yet, the adapter catches the error Convex throws for a
  function the component doesn't export, logs a warning and runs Better Auth's
  compare-and-swap fallback itself, instead of breaking rate limiting for apps
  that haven't updated their `adapter.ts`. `createClient` accepts a component
  without the two functions, and an `adapter.ts` written for upstream, which
  exports them, typechecks.

- 325ae73: Adapter: `findMany` with an `in` on ids or a unique field and a
  `sortBy` puts null and unset values first ascending and last descending, and
  breaks ties in creation order. It compared values with `>`, which is false
  both ways between null and a string, so those rows landed anywhere. It now
  uses the comparison the component's other sort paths use, the order of a
  Convex index, as the security notes document for `sortBy`. A `createdAt` sort
  uses `_creationTime` everywhere, as the index paths do, including the
  in-memory sort and the client sort of OR unions.
- 325ae73: Adapter: `sortBy` is honoured when the `where` has a range (`lt`,
  `lte`, `gt`, `gte`) on another field. An index scan with a range returns rows
  in the order of the ranged field, even when the index has the sort field next,
  so `findMany` on sessions with `expiresAt gt` sorted by `userId`, or by
  `createdAt`, came back in `expiresAt` order, and a `limit` kept the wrong
  rows. These queries are now sorted in memory, as the component already does
  when no index ends in the sort field, the same as SQL's `ORDER BY` without a
  usable index in Better Auth's Kysely, Drizzle and Prisma adapters. A range on
  the sort field itself, or on `createdAt` (applied to the rows the index
  returns), still uses the index. Upstream refuses these sorts instead; refusing
  would break queries Better Auth's SQL adapters answer, so we sort.
- 325ae73: Adapter: a filtered scan past 200 rows no longer reads part of a page
  twice. When a filter rejects rows inside a page, Convex runs out of the page's
  row budget and returns the page with a `splitCursor`. The adapter resumed from
  that cursor, but the page already holds every row up to `continueCursor`, so
  the rows between the two were returned again: `count` and `findMany` returned
  too many rows, and `updateMany` and `deleteMany` counted rows twice and fired
  `onUpdate` triggers twice. The adapter now always continues from
  `continueCursor`, as Convex's pagination contract says (`splitCursor` only
  marks where the page can be cut in two for a reactive query) and as upstream
  does.
- 325ae73: Adapter: `updateMany` updates each matching row once. It patched rows
  while paginating the index its `where` filters on, so an update that moved a
  row past the cursor, such as extending `expiresAt` of sessions selected by
  `expiresAt gt`, read the row again on the next page and patched it, counted it
  and fired its `onUpdate` trigger twice. It now collects the matching ids first
  and updates them in chunks of 200, with the original `where` applied again in
  each chunk so a row that stopped matching in between is left alone. This is
  what SQL's `UPDATE ... WHERE` does in Better Auth's Kysely, Drizzle and Prisma
  adapters: every row that matches when the statement runs is updated once.
  Upstream made the same change. Paginating in creation order instead would
  avoid the moving rows but give up the index and scan the whole table.
  `deleteMany` keeps paginating: a deleted row can't come back after the cursor.
- 325ae73: Adapter: a `where` clause whose value is `undefined` matches no row,
  instead of failing Convex validation with "Missing required field `value`".
  Better Auth's SQL adapters bind `undefined` as a NULL parameter, and a
  comparison with NULL is never true, so Kysely's `where "image" = ?` with
  `undefined` returns no row, for `eq`, `ne`, ranges and `not_in` alike. The
  adapter sends such a clause as one that matches no row, and an OR branch with
  it drops out of the union. Upstream maps `undefined` to `null` instead, which
  makes `eq undefined` match every row where the field is null or unset; with
  `deleteMany` or `updateMany` that would delete or change rows SQL never
  touches, so we follow SQL.
- 325ae73: The `better-auth` peer range is now `>=1.7.16 <1.8.0`, up from
  `>=1.7.5`. Better Auth 1.7.16 has security fixes, and the component is tested
  with it. Apps on Better Auth 1.7.5 to 1.7.15 must upgrade it with this
  release, or npm (and pnpm with strict peer dependencies) refuses the install:
  `better-auth@~1.7.16`. Apps already on 1.7.16 or later don't need to change
  anything.
- 325ae73: Convex JWT cookie: with `twoFactor` before `convex` in `plugins`, a
  sign-in held for the second factor left the `convex_jwt` cookie of the user
  signed in before in the same browser in place, for up to 15 minutes. The
  plugin cleared it on sign-out and when `ctx.context.newSession` was set, but
  `twoFactor`'s after hook expires the session cookie and sets `newSession` to
  `null` before a later plugin's hook runs. The cookie is now also cleared
  whenever the response expires the session cookie, the way Better Auth's
  `deleteSessionCookie` clears the cookies derived from the session
  (`session_data`, `account_data`). Upstream lists sign-in paths instead;
  following the session cookie also covers paths a list misses, such as other
  plugins that cancel or end a session, and doesn't depend on the plugin order.
- 325ae73: OpenID configuration: `/convex/.well-known/openid-configuration`
  still served the document of Better Auth's removed `oidcProvider` plugin. It
  advertised `/oauth2/*` authorization, token, userinfo, registration and end
  session endpoints that nothing serves since Better Auth 1.7, and
  `id_token_signing_alg_values_supported: ["HS256"]`, while the Convex JWT is
  signed with EdDSA or RS256. It now lists what the plugin serves, as upstream
  0.13.0 does: `issuer` and `jwks_uri`, which are all Convex reads, plus the
  fields OpenID Connect Discovery requires, with the algorithm from your Convex
  auth config and the claims every Convex JWT carries. Keeping the old fields
  would point OpenID clients at endpoints that 404, and Better Auth's own
  discovery document lives in `oauthProvider`, which serves those endpoints.
- 325ae73: Cross domain: cookies set by plugins listed after `crossDomain` reach
  the client. The plugin moved `Set-Cookie` into `Set-Better-Auth-Cookie` in an
  after hook, and Better Auth runs after hooks in plugin order, so a later
  hook's cookies went out as plain `Set-Cookie`, which the cross domain client
  never reads. With `twoFactor` after `crossDomain`, the client got the held
  session's token but not the `two_factor` cookie, so the second factor couldn't
  be verified, and with the Convex plugin before `crossDomain`, the expiry of
  the previous user's `convex_jwt` was lost.

  The after hook still moves the cookies set so far, so `auth.api` callers see
  the same headers as before, and marks the response. The plugin's `onResponse`,
  which Better Auth runs after every after hook, moves the rest and removes the
  mark. No official Better Auth plugin uses `onResponse`, so returning a new
  response there doesn't skip another plugin's. Documenting a required plugin
  order instead would leave apps that list `twoFactor` after it, as the docs'
  examples add plugins, broken. Upstream has the same bug. The Convex plugin
  also reads `Set-Better-Auth-Cookie` when it checks whether a response expires
  the session cookie.

- 325ae73: Cross domain client: when `get-session` returns null, the stored
  session is cleared unless the session token cookie itself changed while the
  request was in flight. Before, any change to the stored cookies kept it, so a
  stale session token, `session_data` and `convex_jwt` stayed in storage when an
  unrelated cookie changed meanwhile, such as a new `two_factor` challenge or a
  stored cookie expiring between the request and the response.

  This matches upstream 0.13.0, which compares only the session token. Ours
  matches the cookie name rather than a `.session_token=` substring, so it also
  works without a cookie prefix and ignores multi session cookies.

- 325ae73: Cross domain: `trustedOrigins` entries containing `?` no longer count
  as exact origins. Better Auth treats `?` as a wildcard
  (`matchesOriginPattern`), but the plugin parsed the entry as a URL, so
  `https://app?.example.com` became the exact origin `https://app`, which Better
  Auth never trusts, for starting an OAuth flow and receiving its session. The
  component's request origin check already skips them; both now leave out `*`
  and `?` entries.
- 325ae73: Cross domain: the one-time token verify endpoint is
  `auth.api.verifyCrossDomainOneTimeToken`, the key upstream 0.13.0 uses,
  instead of `crossDomainVerifyOneTimeToken`. The path
  (`/cross-domain/one-time-token/verify`), the storage and the client are
  unchanged, so only code calling the endpoint through `auth.api` needs the new
  name.

  The old key isn't kept as an alias. Two keys for the same path make Better
  Auth's `checkEndpointConflicts` log a path conflict on every start, and the
  client would infer the endpoint twice. Matching upstream's name keeps code
  portable between the fork and `@convex-dev/better-auth`.

- 325ae73: Cross domain: when a magic link or email verification link redirects
  to an origin other than `siteUrl`, the plugin logs a warning with both origins
  instead of redirecting without a session silently, as it already did for an
  OAuth callback on another origin than the one that started the flow. Upstream
  logs a similar warning. Tokens aren't logged.
- 325ae73: `createClient(component, { debugLogs })`: Better Auth's adapter debug
  logs have their own option, with the type of the `debugLogs` of Better Auth's
  adapters (`DBAdapterDebugLogOption`), as in upstream 0.13.0. `verbose` turned
  them on, and they print whole database rows without redaction, including
  session tokens, password hashes and verification values, so turning on verbose
  header logs, which redact credentials, also put credentials in the deployment
  logs.

  Behaviour change: `verbose: true` no longer prints adapter debug logs. Add
  `debugLogs: true` while debugging to get them back. Upstream made the same
  change. Keeping `verbose` as a switch for both would leave the one option that
  looks safe to enable the one that leaks secrets.

- 325ae73: Query context: `consumeOne` and `incrementOne` returned `null` in a
  query, as if no row matched. `@better-auth/api-key` retries its rate limit
  update with a fresh row on a miss (`consumeRateLimit`), so `verifyApiKey` from
  a query, with rate limiting on by default, recursed until the heap ran out.
  They now throw an error that names the method and the endpoint. The other
  writes stay no-ops with a warning, since their callers don't depend on them,
  but an atomic write decides what the caller does next: returning the row would
  accept a one-time token or a rate limited request without recording it, and a
  miss makes callers retry or report the wrong error. Upstream 0.13.0 reverted
  the same no-ops and lets the adapter throw; the component throws from the
  plugin instead, so the error is the same with any adapter and says what to do.
- 325ae73: React: `ConvexBetterAuthProvider` and `AuthBoundary` accept any
  Better Auth React client created with `convexClient()`, whatever its other
  plugins. `AuthClient` was derived from `createAuthClient()` with a fixed
  plugin list, so a client with `inferAdditionalFields()` failed with TS2322. It
  now describes only the parts the component calls, as upstream 0.13.0 does, and
  the new `AuthClientWithCrossDomain` type adds the cross domain ones.

  Upstream's version types the token and one-time token calls as `any`. Ours
  keeps their argument and result shapes, so it is not looser than before: a
  client without `convexClient()` is still rejected, with or without
  `crossDomainClient()`.

- 325ae73: Removes the unused `remeda` dependency. Nothing in the published code
  imports it, so installing the component pulls in one package less.
- 325ae73: Forwarded host (GHSA-9qq3-v9g3-cxhw): the component only set or
  removed `x-forwarded-host` and `x-forwarded-proto`, and left `Host` and the
  request URL as received. Better Auth reads those without
  `advanced.trustedProxyHeaders`: a dynamic `baseURL` takes the `Host` header,
  then the request URL (`getHostFromSource`), and no `baseURL` takes the request
  URL. A self-hosted Convex backend passes a client's `Host` through and builds
  the request URL from it, so with a wildcard in `allowedHosts` a client could
  have a password reset link point to a host it deployed. And without
  `trustedProxyHeaders`, the app's origin from the Next.js and TanStack Start
  handlers was ignored, since only `x-forwarded-*` carried it.

  The component now sets the request URL, `Host`, `x-forwarded-host` and
  `x-forwarded-proto` to one origin on every request, like upstream 0.12.7: the
  app's origin from `x-better-auth-forwarded-*` (or the incoming
  `x-forwarded-*`, which upstream ignores) when it's an exact trusted origin,
  else the request's own origin when it's exactly trusted, else
  `CONVEX_SITE_URL`, and it removes `x-better-auth-forwarded-*`. Setting all
  four gives Better Auth the same origin whichever header its config reads, as a
  proxy in front of a direct deploy would. Removing only the forwarded headers,
  or telling self-hosted users to add a reverse proxy, would leave the default
  Better Auth config exposed. Origins are still compared in full (protocol and
  host), from `trustedOrigins`, `BETTER_AUTH_TRUSTED_ORIGINS` and Better Auth's
  own trusted origins, and wildcard entries still don't count, now including `?`
  patterns, which Better Auth also treats as wildcards.

  A `trustedOrigins` function is called with the request as if it had arrived at
  `CONVEX_SITE_URL`. Called with the request as received, as upstream does, a
  function that trusts the origin of the request's own host would make a
  client's host on a self-hosted backend exactly trusted. Leaving functions out
  of the exact origins would be stricter still, but would drop the app's origin
  for apps that list it from a function.

## 0.13.8

### Patch Changes

- b3be041: Adapter: an empty `in` list matches no rows, as in SQL and Better
  Auth's memory adapter, instead of throwing "Cannot union empty array of
  streams" on fields without a unique index. A second `in` clause is checked
  when the query uses an index, instead of being ignored, so `findMany`,
  `updateMany` and `deleteMany` no longer match rows outside it.
- b3be041: `clientApi().getAuthUser`, a public query, returned the whole user
  document, including fields marked `returned: false`, which Better Auth never
  sends to a client (`parseUserOutput` on `/get-session`). Pass `createAuth` to
  `clientApi(createAuth)` and the query filters the user with Better Auth's
  `parseUserOutput` and your options. Without it the component can't know which
  fields your options hide, so it only returns the core Better Auth user fields
  and the Convex document fields. This is stricter than Better Auth instead of
  looser, and `AuthBoundary`, the query's only user, doesn't read the user. The
  other option, requiring `createAuth`, would break every app on a patch
  release.
- b3be041: Cross domain: the `Better-Auth-Cookie` header is merged into an
  existing `Cookie` header with `; `. It was appended with `headers.append`,
  which joins values with `, ` in some runtimes, so the session token could be
  lost when a server-side caller sent both headers. The cookies are now parsed
  and set one by one with Better Auth's `setRequestCookie`, as its `bearer`
  plugin does. A cookie in `Better-Auth-Cookie` replaces one with the same name
  in `Cookie`, like the bearer token does.
- b3be041: Release workflow: publishing runs in the protected `Release`
  environment, and a manual normal release only runs from `main`, like Better
  Auth's release workflow. Vercel's AI SDK workflow, which ours started from,
  has neither, so a collaborator or a leaked token could run it on an unreviewed
  branch and publish it with valid provenance. Only the environment, required by
  npm trusted publishing, stops this, as a branch can edit the workflow's own
  checks.
- 304f379: Release workflow: only the job that publishes runs in the protected
  `Release` environment, with read-only contents and the npm OIDC token. Opening
  the "Version Packages" pull request and creating the GitHub release run in
  separate jobs outside it, and the optional auto-merge with a personal token is
  gone.

## 0.13.7

### Patch Changes

- 79bf2e0: Match ids chosen by Better Auth in every `id` comparison, and allow
  `id` with `ne`.

  Rows created with an id Better Auth chose keep it in `customId`, and lookups
  by `id` with `eq` and `in` found them. `not_in` only compared the Convex
  `_id`, so `id not_in [chosenId]` still returned that row. Every `id`
  comparison now matches either, like a primary key. `ne` on `id` was rejected;
  it's now accepted, as by any SQL adapter. No Better Auth 1.7 flow uses these
  operators on `id`.

- 79bf2e0: Match SQL for repeated `in` values and `createdAt` ranges next to an
  equality.

  - An `in` clause listing a value twice returned its row twice, and counted it
    twice. Repeated values now match once, as SQL `IN` does.
  - A `createdAt` range combined with an equality on an indexed field, such as
    sessions of a user created before a date, threw
    `Cannot use lt on field 'createdAt'`. The equality still uses the index, and
    the range is applied to the stored `createdAt`.

  No Better Auth 1.7 flow sends these queries, but any SQL adapter handles them.

- 79bf2e0: Fix `in` on a non-unique field whose index has more fields.

  An `in` clause on a field that isn't unique reads one stream per value through
  the field's index and merges them. The merge assumed the streams were ordered
  by creation time, but an index such as `session.userId_expiresAt` orders them
  by `expiresAt` first, so the query threw
  `indexFields must be some sequence of fields the stream is ordered by`, even
  with a single value. The merge now follows the index's order. No Better Auth
  1.7 flow sends such a query, but any SQL adapter handles it.

- 79bf2e0: Allow any number of rows with a null unique field.

  The component checks unique fields itself, since Convex has no unique
  constraints. It skipped unset fields but treated `null` as a value, so once
  one row had a null unique field, the next one was rejected. With the
  `username` plugin, after one user signed up with `username: null`, every later
  sign-up sending `username: null` failed with 422 "Failed to create user". The
  same applied to `phoneNumber` and to `updateMany` setting a unique field to
  null.

  Why this option: in the SQL databases behind Better Auth's Drizzle, Prisma and
  Kysely adapters, NULL in a unique column never conflicts with another NULL.
  Lookups already treat null this way since 0.13.3.

- 79bf2e0: Map renamed fields in `sortBy` and `select`.

  Better Auth passes `sortBy` and `select` with its own field names. The adapter
  passed them to the component unchanged, so with a renamed field, such as
  `user.fields.email: "email_address"`, sorting by it sorted by a field that
  doesn't exist and selecting it returned `undefined`. Better Auth 1.7 itself
  only sorts by `createdAt` and doesn't use `select` in its core flows, so this
  mostly affects plugins and direct adapter calls.

  Why this option: Better Auth's Drizzle and MongoDB adapters map both through
  `getFieldName`, as the adapter already did for where clauses.

- 79bf2e0: Honour `sortBy` when no index covers the sort field.

  The component reads rows in index order. Without an index ending in the sort
  field, it read them in creation order and applied the limit to that, so
  `findMany` returned the wrong rows. For example, admin `listUsers` sorted by
  `role`, organization member lists and API key lists sorted by a field without
  an index. OR queries, sorted again on the client, ordered null values
  inconsistently.

  Now, when no index covers the sort, the component reads every row matching the
  query, sorts them and applies the limit. OR queries are sorted the same way on
  the client. Nulls and unset values come first ascending, as in a Convex index.
  Sorting by an indexed field, or by `createdAt`, is unchanged.

  Why this option: Better Auth's Drizzle, Prisma, Kysely, MongoDB and memory
  adapters always honour `sortBy`; SQL sorts with `ORDER BY` even without an
  index. Reading every matching row can hit Convex's read limit on a large
  table, which fails the query instead of returning the wrong rows, as unindexed
  single row lookups do since 0.13.5.

- 79bf2e0: Keep ids chosen by Better Auth with
  `advanced.database.generateId: "uuid"`.

  The 0.13.6 fix stores the id Better Auth chooses for single-use rows in
  `customId` and rejects a duplicate like a primary key. With
  `generateId: "uuid"`, Better Auth dropped that id before it reached the
  component, because the adapter declared `disableIdGeneration`, so nothing was
  stored or checked. `reserveVerificationValue` returned `true` every time,
  removing the guard on magic link and email OTP sign-in for unverified users
  and on SIWE email claims, and the OAuth provider's `private_key_jwt` replay
  check accepted a reused assertion.

  In `"uuid"` mode the adapter now declares native UUID support instead. Better
  Auth still generates no ids, since Convex picks `_id`, and keeps the UUID it
  derives for these rows, which the component stores in `customId`. Other modes
  are unchanged.

  Why this option: with `"uuid"`, Better Auth derives a UUID for these rows so
  that the SQL adapters keep it as the primary key, and only gives the checks up
  with `"serial"`, with a warning. Ignoring the `"uuid"` setting, as the adapter
  does for `joins`, would also have worked, but would change a setting the app
  chose.

- 79bf2e0: Convex plugin: sign the Convex JWT only where Better Auth's `jwt`
  plugin signs, never on sign-in. Fixes a two-factor bypass when `convex()` is
  listed before `twoFactor()`.

  The plugin signed the JWT in an after hook on every sign-in path and stored it
  in the `convex_jwt` cookie. Better Auth runs plugin hooks in plugin order, so
  with `convex()` before `twoFactor()` it signed for the new session before
  `twoFactor` cancelled it to ask for the second factor. The sign-in response
  then carried a valid JWT, and anyone with only the password could call Convex
  functions that rely on `ctx.auth.getUserIdentity()` until it expired (15
  minutes by default). With `twoFactor()` first, the order in the examples, no
  JWT was set.

  Now the JWT is signed only by `/convex/token`, which requires a session, and
  after `/get-session` returns one, as Better Auth's `jwt` plugin does with
  `/token` and its `/get-session` hook. Also:

  - `/get-session` signs from the session it returns. It no longer signs for an
    expired session, which Better Auth deletes and answers with `null`, and it
    clears the cookie then.
  - Sign-in, sign-up and any other request that starts a new session clear the
    `convex_jwt` cookie, so a JWT of a previous session in the same browser
    isn't reused by server-side rendering with `jwtCache`.
  - The hook no longer calls the token endpoint with empty headers, which logged
    `INTERNAL_SERVER_ERROR` on sign-ins that didn't create a session.

  After a sign-in, the cookie is set by the first `/get-session` call, which the
  client makes right away. Server-side helpers without the cookie fetch the
  token from `/convex/token`, as they already did.

  Why this option: Better Auth's `jwt` plugin never signs on sign-in, only from
  a session that `/token` or `/get-session` has checked. Signing on sign-in
  can't be made safe by plugin order alone, since nothing enforces it. Clearing
  the cookie when a new session starts is stricter than Better Auth, which has
  no JWT cookie.

- 79bf2e0: Convex plugin: always sign the Convex JWT with the algorithm in the
  Convex auth config, and leave other plugins' keys alone.

  The Convex plugin and Better Auth's `jwt` plugin, which `oauthProvider`
  requires, keep their keys in the same `jwks` table. Without a pinned
  algorithm, Better Auth signs with the latest key of any algorithm when there's
  none in the configured one. So if the `jwt` plugin created the first key, the
  Convex JWT was signed with EdDSA, which Convex rejects since its auth config
  expects RS256, and nobody could sign in to Convex. Also, `rotateKeys` and
  `jwksRotateOnTokenGenerationError` deleted every key in the table, including
  the `jwt` plugin's, and `getLatestJwks` could export the `jwt` plugin's key
  labelled as RS256.

  Now:

  - The JWT is signed with `signingAlgorithm` set to the configured algorithm,
    so Better Auth uses or creates a key of that algorithm.
  - `/convex/jwks` publishes only the keys of that algorithm.
  - `rotateKeys`, `getLatestJwks` and `jwksRotateOnTokenGenerationError` only
    use and delete those keys.

  Keys without an `alg`, saved before Better Auth added the column, count as the
  configured algorithm, as in Better Auth. The `jwks` table doesn't record which
  plugin created a key, so keys are told apart by algorithm only: if the `jwt`
  plugin is configured with the same algorithm as Convex, both plugins share
  those keys, and `rotateKeys` affects both.

  Why this option: Better Auth's `oauthProvider` pins `signingAlgorithm` when an
  audience needs a specific algorithm, and Better Auth then picks or creates a
  key of that algorithm, which is what Convex needs. Publishing only those keys
  is stricter than Better Auth's `jwt` plugin, which publishes every key, since
  Convex only accepts one algorithm.

- 79bf2e0: Convex plugin: endpoint keys of its own, so Better Auth's `jwt` and
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

  Why this option: Better Auth's official plugins each use endpoint keys of
  their own, so plugins don't replace each other.

- 79bf2e0: Cross domain client: a late empty `get-session` answer no longer
  clears a session stored meanwhile.

  When `/get-session` answered `null`, `crossDomainClient` removed the stored
  session cookies. On a page loaded with `?ott=`, `useSession` can ask for the
  session before the provider redeems the token. If that empty answer arrived
  after the redemption stored the new session cookie, it removed it and the user
  was signed out. Now the cookies are only cleared if the stored cookie is still
  the one sent with that request.

  Why this option: Better Auth's `expo` client never clears cookies on an empty
  `get-session` answer, only on sign-out. The client keeps clearing a stale
  session the server rejected, but not one it didn't ask about.

- 79bf2e0: Cross domain client: keep the OAuth verifier until a one-time token
  is redeemed.

  `crossDomainClient` sent the stored verifier with every one-time token
  redemption and cleared it before the response arrived. If the redemption
  failed, for example on a network error, a retry had no verifier and the OAuth
  sign-in failed with "Invalid token". The verifier is now cleared only after a
  successful redemption.

- 79bf2e0: Cross domain: close a race that let an OAuth one-time token be
  redeemed without the browser's verifier.

  An OAuth one-time token is bound to the verifier of the browser that started
  the flow. Redeeming it deleted that binding before consuming the token, and
  issuing it created the token before the binding. In either gap, a request with
  only the token, for example from a leaked URL, found no binding and could take
  the session. The binding is now created before the token and deleted only
  after the token is consumed, so the token is never redeemable without it.

- 79bf2e0: Cross domain: the one-time token has its own endpoint key and
  storage, so Better Auth's `oneTimeToken` plugin can be used alongside it.

  The cross domain plugin registered its verify endpoint under
  `verifyOneTimeToken`, the same key as Better Auth's `oneTimeToken` plugin, and
  stored its tokens as `one-time-token:<token>`, like that plugin. Better Auth
  merges plugin endpoints by key and only warns about shared paths, so with both
  plugins the one registered last silently replaced the other's verify endpoint:

  - With `oneTimeToken()` after `crossDomain()`,
    `/cross-domain/one-time-token/verify` returned 404, so cross domain sign-in
    failed, and `/one-time-token/verify` redeemed an OAuth one-time token
    without the verifier of the browser that started the flow (with the default
    `storeToken: "plain"`).
  - With `oneTimeToken()` first, `/one-time-token/verify` returned 404.

  The endpoints are now `crossDomainOAuthStart` and
  `crossDomainVerifyOneTimeToken` in `auth.api`, the paths and the client don't
  change. Tokens are stored as `cross-domain-ott:<token>` and redeemed by the
  plugin itself, with the same steps as the `oneTimeToken` plugin, except that
  an expired session is rejected before its cookie is set. A token issued in the
  3 minutes before the upgrade can't be redeemed after it, and the user has to
  sign in again.

  Why this option: Better Auth's official plugins each use endpoint keys and
  verification identifiers of their own (`magicLinkVerify`, `oauthPopupStart`),
  so plugins don't replace each other. Tokens issued before the upgrade aren't
  accepted under the old prefix, since that would let the cross domain endpoint
  redeem tokens of the `oneTimeToken` plugin.

- 79bf2e0: Cross domain client: read the referrer policy from the last meta tag,
  and add only one with `setReferrerPolicy`.

  The warning about a referrer policy that makes OAuth sign-in fail read the
  first `<meta name="referrer">`, but the last one inserted sets the page's
  policy. With `setReferrerPolicy: true`, every sign-in added another meta tag.
  It now reuses its own tag and moves it last.

- 08ad67b: Cross domain: an OAuth sign-in can start from any app listed exactly
  in `trustedOrigins`, and the session is handed back to the app that started
  it.

  Until now the session was only handed to `siteUrl`, so a second app on another
  origin sharing the same Convex backend couldn't sign in with OAuth. Now:

  - `/cross-domain/oauth/start` accepts `siteUrl` and the exact entries of
    `trustedOrigins`, including those returned by a `trustedOrigins` function.
    Wildcard entries such as `https://*.vercel.app` are still rejected.
  - The one-time token is only issued when the callback URL is on the origin
    that started the flow, and is still only redeemable by the browser that
    started it.
  - Relative `callbackURL`, `newUserCallbackURL` and `errorCallbackURL` values
    of an OAuth sign-in resolve against the app that started it. Sign-ins from
    `siteUrl`'s origin keep resolving against `siteUrl`, path included.
  - Magic links still only hand the session to `siteUrl`.

  Why this option: Better Auth keeps the session on the auth server, and its
  official plugins only hand it to another web origin when that origin started
  the flow in the same browser (`oauth-popup`, `oauth-proxy`). No official
  plugin hands a magic link session to another web origin, since anyone can
  request a link with any callback URL, so magic links stay on `siteUrl`, your
  app, as `expo` only hands them to the app's scheme. Upstream 0.12.6 instead
  hands the token to any exact trusted origin in the callback URL, for magic
  links too, which goes further than Better Auth does. The plugin stays stricter
  than `oauth-popup` in two ways: wildcard origins can't start a flow, and a
  callback URL on another origin than the one that started the flow gets no
  session.

- 79bf2e0: Cross domain: hand the session created by email verification to the
  app at `siteUrl`.

  With `autoSignInAfterVerification`, and when confirming an email change,
  Better Auth creates a session for whoever opens the verification link and sets
  it as a cookie of the auth server. With the cross domain plugin that cookie is
  on your Convex site, so the user reached the app signed out and the session
  was left unused. Opening the link now redirects with a one-time token, like a
  magic link.

  Why this option: Better Auth's `expo` plugin hands the session from
  `/verify-email` to the app, as it does for magic links and OAuth callbacks,
  and only to the app's own scheme, never to another web origin. Verification
  links are sent by email and can be requested with any trusted callback URL,
  so, like magic links, the token only goes to `siteUrl` and isn't tied to a
  browser.

- 79bf2e0: The component no longer passes unchecked `x-forwarded-*` headers to
  Better Auth. Fixes the forwarded host issue (GHSA-pgx2-m66h-x29f) on
  self-hosted Convex.

  When no valid `x-better-auth-forwarded-*` headers arrived, the component
  passed the request's `x-forwarded-host` and `x-forwarded-proto` to Better Auth
  as they were. Convex's cloud edge replaces those a client sends with its own,
  so there they were safe. A self-hosted Convex backend passes them through, and
  builds the request URL from them. With `advanced.trustedProxyHeaders` and a
  dynamic `baseURL` whose `allowedHosts` has a wildcard, anyone could call the
  Convex site directly with `x-forwarded-host: attacker.vercel.app` and get
  password reset, verification and magic links pointing to their host.

  Now the component sets both headers itself on every request: from
  `x-better-auth-forwarded-*`, or else from the incoming `x-forwarded-*`, only
  if they form an origin listed exactly in the trusted origins. Otherwise it
  removes them, and Better Auth falls back to the `Host` header and the request
  URL. On Convex's cloud this changes nothing for apps: `Host` is the same host
  the edge put in `x-forwarded-host`.

  Why this option: Better Auth trusts `x-forwarded-*` with `trustedProxyHeaders`
  because the proxy in front of it sets them. Here that proxy is the component,
  so it owns those headers instead of trusting whatever arrived. Verified
  against a Convex Cloud deployment, which replaced spoofed headers, and the
  self-hosted backend, which passed them through.

- 79bf2e0: Don't evaluate `trustedOrigins` for forwarded headers that change
  nothing.

  Since the forwarded host fix in this release, the component checked the
  incoming `x-forwarded-*` against the trusted origins on every request, which
  on Convex's cloud is every request, since the edge always sends them, and ran
  the app's `trustedOrigins` function each time. When they match the `Host`
  header and the request URL, which is what the edge sends, keeping or removing
  them gives Better Auth the same host and protocol, so they're now left as they
  arrived without the check. Everything else is checked as before.

- 79bf2e0: `getToken` no longer sends `x-forwarded-proto` to the Convex site.

  Like the Next.js and TanStack Start handlers, the server helpers that fetch
  the Convex token (`fetchAuthQuery`, `isAuthenticated` and the rest) now move
  the inbound `x-forwarded-proto` to `x-better-auth-forwarded-proto` and drop
  it, as they already did with `x-forwarded-host`. Only the
  `x-better-auth-forwarded-*` headers carry the app's host and protocol, which
  the component restores for exact trusted origins.

- 79bf2e0: `getToken` takes the forwarded host only from the platform's headers.

  The server helpers that fetch the Convex token moved the inbound
  `x-forwarded-host` and `x-forwarded-proto` to the `x-better-auth-forwarded-*`
  headers, unless the request already had those. Anyone can send
  `x-better-auth-forwarded-*` to the app, so a client-sent value won over the
  one the hosting platform set. They now always use the platform's values, and
  drop client-sent ones, as the Next.js and TanStack Start handlers do. The
  impact was small: it only affected the sender's own request, and the component
  only restores exact trusted origins.

  Why this option: a proxy that Better Auth trusts with `trustedProxyHeaders`
  overwrites the forwarded headers a client sends, which is what makes them
  trustworthy. The framework handlers already did.

- 79bf2e0: Order the equality fields of table-level indexes the same way in the
  schema generator and in the adapter.

  The generator sorted the fields of the table-level indexes Better Auth
  declares by code unit, and the adapter looked equality fields up in
  `localeCompare` order. They differ when field names differ only by case, such
  as `orgId` and `organizationId`, so the adapter didn't find the generated
  index and scanned the table. Both now use code unit order, which doesn't
  depend on the locale. No index Better Auth 1.7 or the generated schemas
  declare today changes order.

- 79bf2e0: Next.js and TanStack Start handlers: drop hop-by-hop request headers
  before forwarding to Convex.

  The handlers removed `transfer-encoding`, `content-length` and `connection`
  from the request they forward, but kept `expect`, `keep-alive` and `upgrade`,
  which Node's fetch rejects. A request carrying one of them, for example a
  large POST from curl, which sends `Expect: 100-continue`, failed with a 500.
  The handlers now drop every hop-by-hop header (RFC 9110 section 7.6.1), the
  ones listed in `Connection`, and `expect`, as they already did for the
  response.

- 79bf2e0: `ConvexBetterAuthProvider` keeps the router's history state when it
  removes `?ott=` from the URL.

  It replaced the history entry with an empty state, which drops what routers
  such as TanStack Router and the Next.js app router keep there. It now keeps
  the current state and only changes the URL.

- 79bf2e0: TanStack Start: add `isAuthenticated()`, which checks the session
  with the server.

  The JWT caching docs said `isAuthenticated()` always checks the session, but
  only the Next.js helpers had it. In TanStack Start, `getToken()` returns the
  JWT cached in the `convex_jwt` cookie when `jwtCache` is enabled, which stays
  valid after the session ends. `convexBetterAuthReactStart` now returns
  `isAuthenticated()`, which always fetches a fresh token, as the Next.js helper
  does and as Better Auth's `getSession` checks the session.

- 79bf2e0: Schema generation: `connectionId_orderKey` indexes on `scimUser` and
  `scimGroup`.

  The SCIM plugin lists a connection's users and groups sorted by `orderKey`.
  With an index on `connectionId` and another on `orderKey` but none on both,
  each page read every user or group of the connection. Local Install apps with
  the SCIM plugin get the indexes when they regenerate their schema.

- 79bf2e0: Static JWKS: drop expired keys, as Better Auth's JWKS endpoint does.

  With a static `JWKS`, the public key set for the Convex auth config and for
  `jwtCache` verification kept every key, so a key past its `expiresAt` was
  accepted forever. Keys past `expiresAt` plus the 30-day grace period are now
  left out, as `/convex/jwks` and Better Auth's `/jwks` already do. For the
  Convex auth config this is evaluated when you deploy.

- 79bf2e0: `verbose` logs also remove the query string of the `referer` header.

  Requests through the Next.js and TanStack Start handlers carry the page the
  user was on in `referer`, which can hold a token, such as a reset password
  page with `?token=`. Its query string is now redacted, as `location`'s already
  was.

## 0.13.6

### Patch Changes

- 42b6345: Support rows Better Auth creates with an id it chooses, and update to
  Better Auth 1.7.13.

  Since Better Auth 1.7.8, some flows create a row with an id derived from a
  value (`forceAllowId`) and rely on the database rejecting a second row with
  the same id. Convex picks `_id` itself, so the component rejected these rows
  and the flows failed:

  - Magic link and email OTP sign-in for a user whose email isn't verified yet,
    for example someone who signed up with a password and never verified the
    email. Better Auth removes the accounts and sessions created before the
    email was proven, guarded by `reserveVerificationValue`, and the request
    failed with a 500.
  - SIWE sign-in that claims an email.
  - `private_key_jwt` client authentication in the OAuth provider plugin, which
    records each assertion's `jti` in `oauthClientAssertion` to stop replays.

  The `verification` and `oauthClientAssertion` tables now have an optional,
  indexed `customId` field. The adapter stores the chosen id there and rejects a
  second row with the same id in the same mutation, so it behaves like a primary
  key, as in the Drizzle, Prisma, Kysely and MongoDB adapters. Lookups by `id`
  find these rows too. Other tables still reject a chosen id, and a table
  generated before this release fails with an error asking to regenerate the
  schema instead of skipping the check.

- cf5af92: Merge upstream 0.12.6. The forwarded host is only restored for exact
  trusted origins (GHSA-pgx2-m66h-x29f).

  The framework handlers send the app's host and protocol in
  `x-better-auth-forwarded-host` and `x-better-auth-forwarded-proto`, and anyone
  can call the Convex site with these headers. The component used to copy them
  to `x-forwarded-host` and `x-forwarded-proto` unconditionally. Now it copies
  them only when together they form an origin listed exactly in
  `trustedOrigins`, `BETTER_AUTH_TRUSTED_ORIGINS` or the `allowedHosts` of a
  dynamic `baseURL`. Wildcard entries don't count, and both headers are restored
  or neither is. The Next.js and TanStack Start handlers no longer send
  `x-forwarded-proto` to Convex.

  This only matters for apps with `advanced.trustedProxyHeaders` enabled, since
  Better Auth ignores `x-forwarded-*` otherwise. If such an app relied on a
  wildcard host for links in emails, list the hosts exactly or set `SITE_URL`
  per preview deployment.

  Also from upstream: `register` in `@convex-dev/better-auth/test` returns the
  component API, `convex-helpers` ^0.1.128, and the SvelteKit guide targets
  SvelteKit 3. The cross domain fix in 0.12.6 (GHSA-j8qq-g9pm-v3c2) is already
  covered by 0.13.3, which only hands one-time tokens to `siteUrl`.

## 0.13.5

### Patch Changes

- 343a0ae: Add indexes for Better Auth lookups that had none. Lookups for a
  single row without an index used to read at most 200 rows, so once a table
  grew past 200 rows they could report an existing row as missing.

  - `account`: `accountId_providerId_userId`. Better Auth 1.7 looks up the
    credential account by these three fields (`findCredentialAccount`). Once the
    `account` table grew past 200 rows, password reset and set password could
    miss the account and create a second credential account instead of updating
    the existing one. Sign-in kept checking the old password, so users got a 401
    with their new password.
  - `session`: `userId_expiresAt`, for listing a user's active sessions
    (`/list-sessions`, the anonymous plugin). It scanned the whole `session`
    table on every call.
  - `twoFactor`: `secret`.

  Single row lookups (`findOne`, `update`, `delete`) without an index now keep
  reading the table until they find a matching row or reach its end. They used
  to stop after the first 200 rows and report the row as missing. A lookup
  without an index is still slow and logs a `Querying without an index` warning,
  and on a large table it can fail with Convex's read limit instead of returning
  a wrong result.

  Schema generation now creates an index for every field Better Auth marks with
  `index: true`, as the Drizzle and Prisma generators do. It ignored them
  before, which left out, among others, `apikey.key` (checked on every request
  authenticated with an API key), `passkey.credentialID` (passkey sign-in) and
  `authorizationCodeId` in the OAuth provider token tables.

  With Local Install, plugin tables also get indexes for their lookups:
  organization (`member`, `teamMember`, `invitation`, `organizationRole`), SIWE,
  SSO, OAuth provider, API key, Stripe and SCIM. Indexes on fields a table
  doesn't have, such as the Stripe fields when Stripe isn't used, are skipped.

  Schema generation now keeps the field order of compound indexes instead of
  sorting the fields alphabetically. Sorting moved range fields such as
  `expiresAt` in front of the equality fields, so the index couldn't be used.

  Apps using Local Install need to regenerate their schema and deploy. Apps that
  reset passwords with an earlier 0.13 release and have more than 200 accounts
  should check for users with more than one `credential` account. See "Upgrading
  to 0.13.5" in the 0.13 migration guide.

## 0.13.4

### Patch Changes

- The adapter now returns date fields to Better Auth as `Date` objects, as
  Better Auth's types say and as other adapters do. With epoch milliseconds,
  Better Auth 1.7 rejected the session cookie cache on every request
  (`Cookie cache payload failed schema validation`), so the cache never worked
  and the `session_data` cookie was set again on each `get-session`. This made
  Expo clients request the session in a loop. Code paths in Better Auth that
  call `.getTime()` on a date, such as signing out of OAuth providers with an
  end session URL, no longer throw.

  Dates are still stored as numbers, and `getAuthUser`, `safeGetAuthUser`,
  `getAnyUserById`, triggers, the Convex JWT claims, `rotateKeys` and
  `getLatestJwks` still return numbers.

  Breaking: results of `auth.api.*` calls and rows passed to `databaseHooks` now
  hold `Date` objects, which Convex functions can't return or pass to
  `runMutation`, `runQuery` or the scheduler. Convert them to numbers first.
  Better Auth HTTP responses, such as `/get-session`, carry dates as ISO strings
  instead of numbers. See "Upgrading to 0.13.4" in the 0.13 migration guide.

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
