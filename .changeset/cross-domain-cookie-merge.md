---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: the `Better-Auth-Cookie` header is merged into an existing
`Cookie` header with `; `. It was appended with `headers.append`, which joins
values with `, ` in some runtimes, so the session token could be lost when a
server-side caller sent both headers. The cookies are now parsed and set one by
one with Better Auth's `setRequestCookie`, as its `bearer` plugin does. A cookie
in `Better-Auth-Cookie` replaces one with the same name in `Cookie`, like the
bearer token does.
