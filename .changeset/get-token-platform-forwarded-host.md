---
"@helixnebulatech/convex-better-auth": patch
---

`getToken` takes the forwarded host only from the platform's headers.

The server helpers that fetch the Convex token moved the inbound
`x-forwarded-host` and `x-forwarded-proto` to the `x-better-auth-forwarded-*`
headers, unless the request already had those. Anyone can send
`x-better-auth-forwarded-*` to the app, so a client-sent value won over the one
the hosting platform set. They now always use the platform's values, and drop
client-sent ones, as the Next.js and TanStack Start handlers do. The impact was
small: it only affected the sender's own request, and the component only
restores exact trusted origins.

Why this option: a proxy that Better Auth trusts with `trustedProxyHeaders`
overwrites the forwarded headers a client sends, which is what makes them
trustworthy. The framework handlers already did.
