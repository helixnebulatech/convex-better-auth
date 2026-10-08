# Helix Nebula fork

Fork of [`get-convex/better-auth`](https://github.com/get-convex/better-auth),
published to npm as `@helixnebulatech/convex-better-auth` so our apps can use
the latest Better Auth without waiting for upstream releases.

| Fork   | Better Auth      | Based on                                                                       |
| ------ | ---------------- | ------------------------------------------------------------------------------ |
| 0.13.0 | `>=1.7.5 <1.8.0` | upstream `0.12.5` + [#444](https://github.com/get-convex/better-auth/pull/444) |
| 0.13.2 | `>=1.7.5 <1.8.0` | 0.13.0 + fixes audited from open upstream pull requests                        |
| 0.13.3 | `>=1.7.5 <1.8.0` | 0.13.2 + security fixes                                                        |

## Use it in an app

Install it under the upstream name with a package alias, so no imports change:

```sh
# npm
npm install @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.3 better-auth@~1.7.7
# pnpm
pnpm add @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.3 better-auth@~1.7.7
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
    aren't tied to a browser, forwarded host headers, adapter calls without a
    `where` clause), the [security notes](./docs/content/docs/security.mdx)
    document it. See [SECURITY.md](./SECURITY.md) to report a vulnerability.
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
3. Merging that pull request publishes to npm, and creates the git tag and the
   GitHub release.

To try a change before releasing it, run the Release workflow manually with
"snapshot" checked. It publishes `0.0.0-<sha>-<timestamp>` under the `snapshot`
dist-tag, which never replaces `latest`:

```sh
pnpm add @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@snapshot
```

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
