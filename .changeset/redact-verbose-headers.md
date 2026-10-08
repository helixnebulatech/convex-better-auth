---
"@helixnebulatech/convex-better-auth": patch
---

`verbose: true` no longer logs credentials from request and response headers:
`Cookie`, `Authorization`, `Set-Cookie`, `Better-Auth-Cookie`,
`Set-Better-Auth-Cookie`, `Set-Auth-Token` and `Set-Auth-JWT` are redacted, and
the CORS router's debug output, which logged raw headers, is no longer enabled.
The Better Auth adapter `debugLogs` are unchanged and log full rows, as
documented on the Debugging page.
