# Developing guide

This repo uses [pnpm](https://pnpm.io). The version is pinned in the
`packageManager` field of `package.json`, and pnpm switches to it on its own
inside the repo.

## Running locally

The examples, `e2e` and `docs` are pnpm workspace packages, so one install at
the root covers all of them.

```sh
pnpm install
cd examples/react
pnpm exec convex dev
```

## Testing

```sh
rm -rf dist/ && pnpm run build
pnpm run typecheck
pnpm run test
pnpm run lint
```

## Deploying

### Building a one-off package

```sh
rm -rf dist/ && pnpm run build
pnpm pack
```

### Releasing

Add a changeset to any pull request that changes `src/`:

```sh
pnpm changeset
```

Releases are published from GitHub Actions. See [FORK.md](./FORK.md#release).
