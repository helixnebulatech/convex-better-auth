---
"@helixnebulatech/convex-better-auth": patch
---

Compare null the way Better Auth's SQL adapters do. `lt`, `lte`, `gt`, `gte`,
`ne` and `not_in` no longer match documents where the field is null or unset,
and a range comparison against `null` matches nothing. Before, Convex's
ordering (null and unset below every value) made, for example, `expiresAt lt
now` also match documents without an `expiresAt`, so `deleteMany` could delete
them, and the two factor plugin's lock reset could match an already cleared
lock. `eq null` and `ne null` keep matching null and unset fields (`IS NULL`,
`IS NOT NULL`).
