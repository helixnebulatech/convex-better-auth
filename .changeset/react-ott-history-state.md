---
"@helixnebulatech/convex-better-auth": patch
---

`ConvexBetterAuthProvider` keeps the router's history state when it removes
`?ott=` from the URL.

It replaced the history entry with an empty state, which drops what routers such
as TanStack Router and the Next.js app router keep there. It now keeps the
current state and only changes the URL.
