---
"@helixnebulatech/convex-better-auth": patch
---

`verbose` logs also remove the query string of the `referer` header.

Requests through the Next.js and TanStack Start handlers carry the page the user
was on in `referer`, which can hold a token, such as a reset password page with
`?token=`. Its query string is now redacted, as `location`'s already was.
