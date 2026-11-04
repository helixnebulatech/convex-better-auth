---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: an account can't be created or updated with the `providerId` and
`accountId` of another account. Better Auth checks for an existing account
before linking one, but two requests racing to link the same provider account
could both pass the check and create two rows. From then on, Better Auth's
internal adapter (`findAccountByKey`, `findAccountOwnerByKey`) throws
"Multiple accounts match the same accountId" and the user can't sign in with
that provider. The component now checks the pair as a unique constraint, in
the same mutation as the write, with the `accountId_providerId` index, the
same way it checks Better Auth's unique fields, so `create`, `update`,
`updateMany` and `incrementOne` all enforce it, and a renamed `accountId` or
`providerId` field is covered. This is stricter than Better Auth's SQL
schema, which declares no constraint for the pair, as allowed where Better
Auth itself breaks on duplicates. Upstream checks only on create; checking on
update too keeps an update from producing the same duplicate.
