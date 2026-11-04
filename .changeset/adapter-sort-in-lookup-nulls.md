---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: `findMany` with an `in` on ids or a unique field and a `sortBy` puts
null and unset values first ascending and last descending, and breaks ties in
creation order. It compared values with `>`, which is false both ways between
null and a string, so those rows landed anywhere. It now uses the comparison
the component's other sort paths use, the order of a Convex index, as the
security notes document for `sortBy`. A `createdAt` sort uses `_creationTime`
everywhere, as the index paths do, including the in-memory sort and the client
sort of OR unions.
