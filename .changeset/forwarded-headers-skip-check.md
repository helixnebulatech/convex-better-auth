---
"@helixnebulatech/convex-better-auth": patch
---

Don't evaluate `trustedOrigins` for forwarded headers that change nothing.

Since the forwarded host fix in this release, the component checked the incoming
`x-forwarded-*` against the trusted origins on every request, which on Convex's
cloud is every request, since the edge always sends them, and ran the app's
`trustedOrigins` function each time. When they match the `Host` header and the
request URL, which is what the edge sends, keeping or removing them gives Better
Auth the same host and protocol, so they're now left as they arrived without the
check. Everything else is checked as before.
