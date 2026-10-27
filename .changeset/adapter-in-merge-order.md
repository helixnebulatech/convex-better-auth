---
"@helixnebulatech/convex-better-auth": patch
---

Fix `in` on a non-unique field whose index has more fields.

An `in` clause on a field that isn't unique reads one stream per value through
the field's index and merges them. The merge assumed the streams were ordered by
creation time, but an index such as `session.userId_expiresAt` orders them by
`expiresAt` first, so the query threw
`indexFields must be some sequence of fields the stream is ordered by`, even
with a single value. The merge now follows the index's order. No Better Auth 1.7
flow sends such a query, but any SQL adapter handles it.
