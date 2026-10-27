---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain client: a late empty `get-session` answer no longer clears a
session stored meanwhile.

When `/get-session` answered `null`, `crossDomainClient` removed the stored
session cookies. On a page loaded with `?ott=`, `useSession` can ask for the
session before the provider redeems the token. If that empty answer arrived
after the redemption stored the new session cookie, it removed it and the user
was signed out. Now the cookies are only cleared if the stored cookie is still
the one sent with that request.

Why this option: Better Auth's `expo` client never clears cookies on an empty
`get-session` answer, only on sign-out. The client keeps clearing a stale
session the server rejected, but not one it didn't ask about.
