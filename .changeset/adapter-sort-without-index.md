---
"@helixnebulatech/convex-better-auth": patch
---

Honour `sortBy` when no index covers the sort field.

The component reads rows in index order. Without an index ending in the sort
field, it read them in creation order and applied the limit to that, so
`findMany` returned the wrong rows. For example, admin `listUsers` sorted by
`role`, organization member lists and API key lists sorted by a field without an
index. OR queries, sorted again on the client, ordered null values
inconsistently.

Now, when no index covers the sort, the component reads every row matching the
query, sorts them and applies the limit. OR queries are sorted the same way on
the client. Nulls and unset values come first ascending, as in a Convex index.
Sorting by an indexed field, or by `createdAt`, is unchanged.

Why this option: Better Auth's Drizzle, Prisma, Kysely, MongoDB and memory
adapters always honour `sortBy`; SQL sorts with `ORDER BY` even without an
index. Reading every matching row can hit Convex's read limit on a large table,
which fails the query instead of returning the wrong rows, as unindexed single
row lookups do since 0.13.5.
