---
"@helixnebulatech/convex-better-auth": patch
---

`getToken` no longer sends `x-forwarded-proto` to the Convex site.

Like the Next.js and TanStack Start handlers, the server helpers that fetch the
Convex token (`fetchAuthQuery`, `isAuthenticated` and the rest) now move the
inbound `x-forwarded-proto` to `x-better-auth-forwarded-proto` and drop it, as
they already did with `x-forwarded-host`. Only the `x-better-auth-forwarded-*`
headers carry the app's host and protocol, which the component restores for
exact trusted origins.
