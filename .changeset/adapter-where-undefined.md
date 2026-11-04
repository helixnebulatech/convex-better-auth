---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: a `where` clause whose value is `undefined` matches no row, instead
of failing Convex validation with "Missing required field `value`". Better
Auth's SQL adapters bind `undefined` as a NULL parameter, and a comparison with
NULL is never true, so Kysely's `where "image" = ?` with `undefined` returns
no row, for `eq`, `ne`, ranges and `not_in` alike. The adapter sends such a
clause as one that matches no row, and an OR branch with it drops out of the
union. Upstream maps `undefined` to `null` instead, which makes `eq undefined`
match every row where the field is null or unset; with `deleteMany` or
`updateMany` that would delete or change rows SQL never touches, so we follow
SQL.
