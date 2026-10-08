# Helix Nebula fork

Fork of [`get-convex/better-auth`](https://github.com/get-convex/better-auth),
published to npm as `@helixnebulatech/convex-better-auth` so our apps can use
the latest Better Auth without waiting for upstream releases.

| Fork   | Better Auth      | Based on                                                                       |
| ------ | ---------------- | ------------------------------------------------------------------------------ |
| 0.13.0 | `>=1.7.5 <1.8.0` | upstream `0.12.5` + [#444](https://github.com/get-convex/better-auth/pull/444) |

## Use it in an app

Install it under the upstream name with an npm alias, so no imports change:

```sh
npm install @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.0 better-auth@~1.7.7
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

## Update Better Auth

```sh
npm install -E better-auth@<version> @better-auth/core@<version> @better-auth/test-utils@<version>
npx auth generate --output src/component/schema.ts
npm run build:codegen  # needs a Convex deployment (CONVEX_DEPLOYMENT)
npm test && npm run typecheck && npm run lint
```

Check the Better Auth changelog for new adapter methods or arguments. The
component validators reject unknown fields, so a new adapter argument breaks
calls until the adapter strips or handles it.

## Release

```sh
npm version <patch|minor> --no-git-tag-version
node scripts/sync-version.mjs
rm -rf dist *.tsbuildinfo && npm run build && npm test
npm publish
git commit -am "<version>" && git tag v<version> && git push --follow-tags
```
