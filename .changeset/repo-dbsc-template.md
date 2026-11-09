---
"@helixnebulatech/convex-better-auth": patch
---

The repository now follows the layout of the Vercel AI SDK and of
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
