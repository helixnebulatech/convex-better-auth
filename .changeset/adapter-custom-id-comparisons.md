---
"@helixnebulatech/convex-better-auth": patch
---

Match ids chosen by Better Auth in every `id` comparison, and allow `id` with
`ne`.

Rows created with an id Better Auth chose keep it in `customId`, and lookups by
`id` with `eq` and `in` found them. `not_in` only compared the Convex `_id`, so
`id not_in [chosenId]` still returned that row. Every `id` comparison now
matches either, like a primary key. `ne` on `id` was rejected; it's now
accepted, as by any SQL adapter. No Better Auth 1.7 flow uses these operators on
`id`.
