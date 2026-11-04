---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: `sortBy` is honoured when the `where` has a range (`lt`, `lte`, `gt`,
`gte`) on another field. An index scan with a range returns rows in the order
of the ranged field, even when the index has the sort field next, so
`findMany` on sessions with `expiresAt gt` sorted by `userId`, or by
`createdAt`, came back in `expiresAt` order, and a `limit` kept the wrong rows.
These queries are now sorted in memory, as the component already does when no
index ends in the sort field, the same as SQL's `ORDER BY` without a usable
index in Better Auth's Kysely, Drizzle and Prisma adapters. A range on the sort
field itself, or on `createdAt` (applied to the rows the index returns), still
uses the index. Upstream refuses these sorts instead; refusing would break
queries Better Auth's SQL adapters answer, so we sort.
