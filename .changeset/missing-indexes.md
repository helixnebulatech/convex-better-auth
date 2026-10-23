---
"@helixnebulatech/convex-better-auth": patch
---

Add indexes for Better Auth lookups that had none. Lookups for a single row
without an index used to read at most 200 rows, so once a table grew past 200
rows they could report an existing row as missing.

- `account`: `accountId_providerId_userId`. Better Auth 1.7 looks up the
  credential account by these three fields (`findCredentialAccount`). Once the
  `account` table grew past 200 rows, password reset and set password could miss
  the account and create a second credential account instead of updating the
  existing one. Sign-in kept checking the old password, so users got a 401 with
  their new password.
- `session`: `userId_expiresAt`, for listing a user's active sessions
  (`/list-sessions`, the anonymous plugin). It scanned the whole `session` table
  on every call.
- `twoFactor`: `secret`.

Single row lookups (`findOne`, `update`, `delete`) without an index now keep
reading the table until they find a matching row or reach its end. They used to
stop after the first 200 rows and report the row as missing. A lookup without an
index is still slow and logs a `Querying without an index` warning, and on a
large table it can fail with Convex's read limit instead of returning a wrong
result.

Schema generation now creates an index for every field Better Auth marks with
`index: true`, as the Drizzle and Prisma generators do. It ignored them before,
which left out, among others, `apikey.key` (checked on every request
authenticated with an API key), `passkey.credentialID` (passkey sign-in) and
`authorizationCodeId` in the OAuth provider token tables.

With Local Install, plugin tables also get indexes for their lookups:
organization (`member`, `teamMember`, `invitation`, `organizationRole`), SIWE,
SSO, OAuth provider, API key, Stripe and SCIM. Indexes on fields a table doesn't
have, such as the Stripe fields when Stripe isn't used, are skipped.

Schema generation now keeps the field order of compound indexes instead of
sorting the fields alphabetically. Sorting moved range fields such as
`expiresAt` in front of the equality fields, so the index couldn't be used.

Apps using Local Install need to regenerate their schema and deploy. Apps that
reset passwords with an earlier 0.13 release and have more than 200 accounts
should check for users with more than one `credential` account. See "Upgrading
to 0.13.5" in the 0.13 migration guide.
