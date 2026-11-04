---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: a filtered scan past 200 rows no longer reads part of a page twice.
When a filter rejects rows inside a page, Convex runs out of the page's row
budget and returns the page with a `splitCursor`. The adapter resumed from that
cursor, but the page already holds every row up to `continueCursor`, so the rows
between the two were returned again: `count` and `findMany` returned too many
rows, and `updateMany` and `deleteMany` counted rows twice and fired `onUpdate`
triggers twice. The adapter now always continues from `continueCursor`, as
Convex's pagination contract says (`splitCursor` only marks where the page can
be cut in two for a reactive query) and as upstream does.
