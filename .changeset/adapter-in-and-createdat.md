---
"@helixnebulatech/convex-better-auth": patch
---

Match SQL for repeated `in` values and `createdAt` ranges next to an equality.

- An `in` clause listing a value twice returned its row twice, and counted it
  twice. Repeated values now match once, as SQL `IN` does.
- A `createdAt` range combined with an equality on an indexed field, such as
  sessions of a user created before a date, threw
  `Cannot use lt on field 'createdAt'`. The equality still uses the index, and
  the range is applied to the stored `createdAt`.

No Better Auth 1.7 flow sends these queries, but any SQL adapter handles them.
