---
"@helixnebulatech/convex-better-auth": patch
---

Map renamed fields in `sortBy` and `select`.

Better Auth passes `sortBy` and `select` with its own field names. The adapter
passed them to the component unchanged, so with a renamed field, such as
`user.fields.email: "email_address"`, sorting by it sorted by a field that
doesn't exist and selecting it returned `undefined`. Better Auth 1.7 itself only
sorts by `createdAt` and doesn't use `select` in its core flows, so this mostly
affects plugins and direct adapter calls.

Why this option: Better Auth's Drizzle and MongoDB adapters map both through
`getFieldName`, as the adapter already did for where clauses.
