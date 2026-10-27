---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: an empty `in` list matches no rows, as in SQL and Better Auth's memory
adapter, instead of throwing "Cannot union empty array of streams" on fields
without a unique index. A second `in` clause is checked when the query uses an
index, instead of being ignored, so `findMany`, `updateMany` and `deleteMany` no
longer match rows outside it.
