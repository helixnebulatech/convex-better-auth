# Developing guide

This repo is a [Bun](https://bun.sh) workspace, laid out like the Vercel AI SDK.
The Bun version is pinned in the `packageManager` field of `package.json`.

| Path                          | What                                                          |
| ----------------------------- | ------------------------------------------------------------- |
| `packages/convex-better-auth` | The published package (`@helixnebulatech/convex-better-auth`) |
| `examples/*`                  | Example apps, linked to the package                           |
| `e2e`                         | Playwright tests against a local Convex backend               |
| `docs`                        | The documentation site                                        |

## Matching Better Auth

Before choosing how to implement a fix or a feature, look at what Better Auth
core and its official plugins do in the same situation, in their source, and do
the same. See [How we decide](./FORK.md#how-we-decide).

## Setup

```sh
bun install
bun run build         # the package, with tsdown
bun run test          # Vitest
bun run check-types   # tsrs for the package, tsc for the examples
bun run check         # Ultracite (oxlint + oxfmt); `bun run fix` to fix
bun run publint
```

The end-to-end tests deploy `examples/react` to a local Convex backend and drive
it with Playwright:

```sh
cd e2e
bun x playwright install chromium firefox
bun run test
```

To work on an example:

```sh
cd examples/react
bun x convex dev
```

## Code style

[Ultracite](https://www.ultracite.ai)'s oxlint and oxfmt presets, with the
style-only rules turned off in `oxlint.config.ts` so the code stays close to
upstream and merges stay small. Each exception there says why. Convex's own lint
rules run through oxlint's JS plugins.

## Dependencies

- Dev dependencies are pinned to exact versions. Runtime and peer dependencies
  use `^` ranges.
- `bunfig.toml` sets `minimumReleaseAge` to 3 days: Bun does not install
  versions younger than that. Dependabot uses the same cooldown.
- GitHub Actions are pinned to commit SHAs.

## Changesets

Every pull request that changes `packages/convex-better-auth/src` needs a
changeset:

```sh
bun run changeset
```

Use `bun run changeset --empty` when a change does not need a release. Releases
are published from GitHub Actions. See [FORK.md](./FORK.md#release).

## Building a one-off package

```sh
bun run build
cd packages/convex-better-auth && npm pack
```
