# Agent notes

- Follow [CONTRIBUTING.md](./CONTRIBUTING.md) and [FORK.md](./FORK.md).
- When a fix or feature can be done in more than one way, check what Better Auth
  core and its official plugins (`node_modules/better-auth/dist`,
  `@better-auth/*`) do in the same situation and replicate it. Stricter than
  Better Auth is allowed when Convex needs it, looser never. See
  [How we decide](./FORK.md#how-we-decide).
- Write the choice down: the matching Better Auth behaviour in
  `docs/content/docs/security.mdx` (or the page for the feature), and why this
  option was chosen in the changeset.
