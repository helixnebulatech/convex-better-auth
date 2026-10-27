---
"@helixnebulatech/convex-better-auth": patch
---

`clientApi().getAuthUser`, a public query, returned the whole user document,
including fields marked `returned: false`, which Better Auth never sends to a
client (`parseUserOutput` on `/get-session`). Pass `createAuth` to
`clientApi(createAuth)` and the query filters the user with Better Auth's
`parseUserOutput` and your options. Without it the component can't know which
fields your options hide, so it only returns the core Better Auth user fields
and the Convex document fields. This is stricter than Better Auth instead of
looser, and `AuthBoundary`, the query's only user, doesn't read the user. The
other option, requiring `createAuth`, would break every app on a patch release.
