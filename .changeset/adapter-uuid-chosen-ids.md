---
"@helixnebulatech/convex-better-auth": patch
---

Keep ids chosen by Better Auth with `advanced.database.generateId: "uuid"`.

The 0.13.6 fix stores the id Better Auth chooses for single-use rows in
`customId` and rejects a duplicate like a primary key. With
`generateId: "uuid"`, Better Auth dropped that id before it reached the
component, because the adapter declared `disableIdGeneration`, so nothing was
stored or checked. `reserveVerificationValue` returned `true` every time,
removing the guard on magic link and email OTP sign-in for unverified users and
on SIWE email claims, and the OAuth provider's `private_key_jwt` replay check
accepted a reused assertion.

In `"uuid"` mode the adapter now declares native UUID support instead. Better
Auth still generates no ids, since Convex picks `_id`, and keeps the UUID it
derives for these rows, which the component stores in `customId`. Other modes
are unchanged.

Why this option: with `"uuid"`, Better Auth derives a UUID for these rows so
that the SQL adapters keep it as the primary key, and only gives the checks up
with `"serial"`, with a warning. Ignoring the `"uuid"` setting, as the adapter
does for `joins`, would also have worked, but would change a setting the app
chose.
