---
"@helixnebulatech/convex-better-auth": patch
---

**`user.createdAt` index, and sorts that follow the sort field's index.** The
admin plugin's `listUsers` can sort the whole user table by `createdAt`. With
`createdAt` sorted by its stored value and no index on it, that sort read every
user in one query, and past Convex's read limit (32,000 documents) the admin
plugin, which catches the error, returned an empty list. The schema now indexes
`user.createdAt`, which Better Auth doesn't declare, as allowed when Convex
needs it. With Local Install, regenerate the schema.

A filter with the sort, such as `listUsers` with `filterField: "role"`, needed
an index on both fields and otherwise sorted in memory, reading the whole table
too. When no index serves the filter, but the sort field has an index of its
own, the component now scans it in sort order and checks the `where` clauses on
each row, a page at a time, as a database does for `ORDER BY` on an indexed
column with a filter on an unindexed one. This applies to any sort field with a
single field index, such as `name`. A filter with its own index still reads the
matching rows through it and sorts them, as before, and a compound index isn't
scanned this way, since it would order ties by its next field rather than by
creation. A range on another field still sorts in memory, since a range scan
returns rows in the ranged field's order. The `next` and `tanstack` examples'
Local Install schemas are regenerated, which also adds the
`verification.customId` field and index they lacked since 0.13.6.
