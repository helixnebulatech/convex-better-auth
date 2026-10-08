---
"@helixnebulatech/convex-better-auth": patch
---

`verbose: true` no longer logs credentials from request and response headers:
`Cookie`, `Authorization`, `Set-Cookie`, `Better-Auth-Cookie`,
`Set-Better-Auth-Cookie`, `Set-Auth-Token`, `Set-Auth-JWT` and `X-Api-Key` are
redacted, redirect `Location` headers are logged without their query string,
which can carry one-time tokens, and the CORS router's debug output, which
logged raw headers, is no longer enabled. `verbose` still turns on Better Auth's
adapter `debugLogs`, which are unchanged and log full rows, as documented on the
Debugging page.
