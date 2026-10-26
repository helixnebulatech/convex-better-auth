# Helix Nebula fork

Fork of [`get-convex/better-auth`](https://github.com/get-convex/better-auth),
published to npm as `@helixnebulatech/convex-better-auth` so our apps can use
the latest Better Auth without waiting for upstream releases.

| Fork   | Better Auth      | Based on                                                                       |
| ------ | ---------------- | ------------------------------------------------------------------------------ |
| 0.13.0 | `>=1.7.5 <1.8.0` | upstream `0.12.5` + [#444](https://github.com/get-convex/better-auth/pull/444) |
| 0.13.2 | `>=1.7.5 <1.8.0` | 0.13.0 + fixes audited from open upstream pull requests                        |
| 0.13.3 | `>=1.7.5 <1.8.0` | 0.13.2 + security fixes                                                        |
| 0.13.4 | `>=1.7.5 <1.8.0` | 0.13.3 + dates returned to Better Auth as `Date` objects                       |
| 0.13.5 | `>=1.7.5 <1.8.0` | 0.13.4 + missing indexes, single row lookups without an index                  |
| 0.13.6 | `>=1.7.5 <1.8.0` | 0.13.5 + upstream `0.12.6`, ids chosen by Better Auth, tested with 1.7.13      |

## Use it in an app

Install it under the upstream name with a package alias, so no imports change:

```sh
# npm
npm install @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.6 better-auth@~1.7.13
# pnpm
pnpm add @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.6 better-auth@~1.7.13
```

Then follow the
[0.13 migration guide](./docs/content/docs/migrations/migrate-to-0-13.mdx).

## Differences from upstream

- Better Auth 1.7.x support, from upstream PR #444.
- Strips `modelKey` (added in Better Auth 1.7.6) before calling component
  functions. Without this, most adapter calls fail validation on 1.7.6+.
- Native `consumeOne`. Better Auth's fallback guards on `_creationTime`, which
  the component rejects, so magic links, email OTP, one-time tokens and cross
  domain sign in all failed.
- `consumeOne`/`incrementOne` are no-ops in query context, from upstream PR
  #430.
- Fixes audited from the open upstream pull requests. Each bug was reproduced
  with a failing test before it was fixed, and the fix was reviewed or rewritten
  where the upstream one was wrong or incomplete:
  - Adapter: `id` where clauses no longer match other models (#411), AND clauses
    combined with OR are applied (#404), unset optional fields match `null`
    (#425), `findMany` supports `offset` (#406), unique constraints cover
    renamed fields and table-level indexes (#430), and token lists use the
    unique index instead of a table scan (#314, without its extra index).
  - Schema: `rateLimit.lastRequest` index (#436).
  - Convex plugin: static JWKS with several keys or `expiresAt` (#428).
  - Cross domain: no spurious "No session found" log (#417).
  - React and SSR: auth kept during hydration and tokens cached per session
    (#431), `jwtCache` retries only on auth errors (#440),
    `usePreloadedAuthQuery` typed as `undefined` (#441).
  - Next.js and TanStack Start: hop-by-hop response headers stripped (#415),
    `x-forwarded-host` no longer sent to Convex (#423), `convexUrl` passed to
    the Next.js helpers (#359).
- Security fixes from our own audit, matching Better Auth's native behaviour:
  - Cross domain: OAuth sign-in and account linking are tied to the browser that
    started them (the state cookie check is back), OAuth one-time tokens can
    only be redeemed by that browser, and one-time tokens are only handed to
    `siteUrl`.
  - `jwtCache`: the cached JWT is verified, and `isAuthenticated()` always
    checks the session.
  - `verbose` header logs redact cookies and tokens. Better Auth's adapter debug
    logs, which `verbose` also turns on, still print full rows.
  - The sign-in JWT no longer includes `returned: false` user and session
    fields.
  - Null comparisons match Better Auth's SQL adapters.
  - The Next.js example and docs snippets no longer expose other users' data.
  - Where the component behaves as Better Auth does on purpose (magic links
    aren't tied to a browser, adapter calls without a `where` clause), the
    [security notes](./docs/content/docs/security.mdx) document it. See
    [SECURITY.md](./SECURITY.md) to report a vulnerability.
- Indexes and lookups, from our own audit of every lookup Better Auth 1.7 and
  its official plugins make:
  - Indexes for lookups that had none, such as the credential account lookup
    added in Better Auth 1.7 and listing a user's active sessions.
  - Schema generation indexes the fields Better Auth marks with `index: true`,
    keeps the field order of compound indexes, and skips indexes on fields a
    table doesn't have.
  - Single row lookups without an index read the whole table instead of stopping
    after 200 rows and reporting the row as missing.
- Upstream `0.12.6` merged, with its two security fixes adapted:
  - Forwarded host (GHSA-pgx2-m66h-x29f): taken, but the component matches the
    full origin (protocol and host) against the exact trusted origins, not only
    the host, and the framework handlers also drop an incoming
    `x-forwarded-proto`.
  - Cross domain one-time tokens (GHSA-j8qq-g9pm-v3c2): ours kept. Upstream
    hands tokens to any origin listed exactly in `trustedOrigins`, ours only to
    `siteUrl`.
- Ids chosen by Better Auth: since Better Auth 1.7.8, magic link and email OTP
  sign-in for unverified users, SIWE email claims and the OAuth provider's
  `private_key_jwt` replay check create rows with an id Better Auth picks and
  rely on the primary key to reject a duplicate. The `verification` and
  `oauthClientAssertion` tables keep that id in an indexed `customId` field, and
  the component enforces it like a primary key.
- Not taken: #400 (breaks existing data), #405 (no Better Auth flow uses it),
  #418 (breaks sync storage), #438 (caching the JWKS by default breaks key
  rotation), #445 (performance only).

## Sync with upstream

```sh
git remote add upstream https://github.com/get-convex/better-auth.git
git fetch upstream
git merge upstream/main
```

Keep `name`, `repository`, `homepage`, `bugs` and `publishConfig` in
`package.json` on the fork values when resolving conflicts. When upstream
supports the Better Auth line we need, consider moving apps back to
`@convex-dev/better-auth`.

## Development

The repo uses pnpm, pinned in `packageManager`. The examples, `e2e` and `docs`
are workspace packages that share one `pnpm-lock.yaml`, so a single
`pnpm install` at the root sets everything up. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Update Better Auth

Set the new version in the root `package.json` (`better-auth`,
`@better-auth/core`, `@better-auth/test-utils`) and in each example's
`package.json`, then:

```sh
pnpm install
pnpm dlx auth@<version> generate --output src/component/schema.ts
pnpm run build:codegen  # needs a Convex deployment (CONVEX_DEPLOYMENT)
pnpm test && pnpm run typecheck && pnpm run lint
```

`pnpm-workspace.yaml` blocks versions published less than 7 days ago. To use a
newer Better Auth release before that, add its packages to
`minimumReleaseAgeExclude`:

```yaml
minimumReleaseAgeExclude:
  - better-auth
  - "@better-auth/*"
```

Check the Better Auth changelog for new adapter methods or arguments. The
component validators reject unknown fields, so a new adapter argument breaks
calls until the adapter strips or handles it.

## Release

Releases are published from GitHub Actions with
[Changesets](https://github.com/changesets/changesets), the same flow Vercel
uses for the AI SDK. npm
[trusted publishing](https://docs.npmjs.com/trusted-publishers) authenticates
the workflow with OIDC, so there is no npm token in the repo, and every version
ships with
[provenance](https://docs.npmjs.com/generating-provenance-statements).

1. Every pull request that changes `src/` adds a changeset with
   `pnpm changeset`. The Verify Changesets check fails without one. Use
   `pnpm changeset --empty` when a change does not need a release.
2. When changesets land on `main`, the Release workflow opens or updates a
   "Version Packages" pull request. It bumps the version, syncs `src/version.ts`
   and writes `CHANGELOG.md`.
3. Review the "Version Packages" pull request: check the version bump and the
   `CHANGELOG.md` entry. GitHub holds its "Test and lint" and "Verify
   Changesets" runs until someone approves them, because a bot opened the pull
   request. Approve them from the pull request checks ("Approve and run"), then
   approve the pull request once they pass.
4. Merging that pull request publishes to npm, and creates the git tag and the
   GitHub release.

The Release workflow can enable auto-merge on the "Version Packages" pull
request if the `RELEASE_BOT_TOKEN` secret holds a token allowed to merge. We
leave it unset, so a person reviews every release before it's published. Vercel
also merges its release pull requests by hand.

To try a change before releasing it, run the Release workflow manually with
"snapshot" checked. It publishes `0.0.0-<sha>-<timestamp>` under the `snapshot`
dist-tag, which never replaces `latest`:

```sh
pnpm add @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@snapshot
```

### Rules on `main`

A ruleset protects `main`:

- Changes land through pull requests, merged with squash. Direct pushes, force
  pushes and deleting the branch are blocked.
- Every pull request needs 1 approval, and the "Test and lint" and "Verify
  Changesets" checks must pass.
- Commits must be signed. Squash merges are signed by GitHub.
- Repository admins can bypass the rules, but only inside a pull request. With a
  single maintainer this is how your own pull requests get merged, since GitHub
  doesn't let authors approve their own pull requests. GitHub records each
  bypass. Pull requests opened by a bot, such as "Version Packages", can be
  approved normally.

### One-time setup

- In the GitHub repo settings, under Actions > General, allow GitHub Actions to
  create and approve pull requests.
- Publish the first version by hand with `pnpm publish`, as npm needs the
  package to exist before it can trust a publisher.
- Trust the Release workflow on npm. This needs npm 11.15 or later and 2FA on
  the npm account. The same setting is in the package settings on npmjs.com.

  ```sh
  npm trust github @helixnebulatech/convex-better-auth --repo helixnebulatech/convex-better-auth --file release.yml --allow-publish
  ```
