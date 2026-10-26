---
"@helixnebulatech/convex-better-auth": patch
---

Support rows Better Auth creates with an id it chooses, and update to Better
Auth 1.7.13.

Since Better Auth 1.7.8, some flows create a row with an id derived from a value
(`forceAllowId`) and rely on the database rejecting a second row with the same
id. Convex picks `_id` itself, so the component rejected these rows and the
flows failed:

- Magic link and email OTP sign-in for a user whose email isn't verified yet,
  for example someone who signed up with a password and never verified the
  email. Better Auth removes the accounts and sessions created before the email
  was proven, guarded by `reserveVerificationValue`, and the request failed with
  a 500.
- SIWE sign-in that claims an email.
- `private_key_jwt` client authentication in the OAuth provider plugin, which
  records each assertion's `jti` in `oauthClientAssertion` to stop replays.

The `verification` and `oauthClientAssertion` tables now have an optional,
indexed `customId` field. The adapter stores the chosen id there and rejects a
second row with the same id in the same mutation, so it behaves like a primary
key, as in the Drizzle, Prisma, Kysely and MongoDB adapters. Lookups by `id`
find these rows too. Other tables still reject a chosen id, and a table
generated before this release fails with an error asking to regenerate the
schema instead of skipping the check.
