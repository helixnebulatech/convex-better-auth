# Changesets

Every pull request that changes the published package needs a changeset. Run
`pnpm changeset`, pick the bump type and describe the change for users. The
description goes into `CHANGELOG.md`.

- `patch`: bug fixes and Better Auth patch updates
- `minor`: a new Better Auth minor line (for example 1.7 to 1.8) or other
  breaking changes, as the package is still on 0.x
- `major`: reserved for 1.0

See [FORK.md](../FORK.md#release) for how releases are published.
