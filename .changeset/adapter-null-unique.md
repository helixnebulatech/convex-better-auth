---
"@helixnebulatech/convex-better-auth": patch
---

Allow any number of rows with a null unique field.

The component checks unique fields itself, since Convex has no unique
constraints. It skipped unset fields but treated `null` as a value, so once one
row had a null unique field, the next one was rejected. With the `username`
plugin, after one user signed up with `username: null`, every later sign-up
sending `username: null` failed with 422 "Failed to create user". The same
applied to `phoneNumber` and to `updateMany` setting a unique field to null.

Why this option: in the SQL databases behind Better Auth's Drizzle, Prisma and
Kysely adapters, NULL in a unique column never conflicts with another NULL.
Lookups already treat null this way since 0.13.3.
