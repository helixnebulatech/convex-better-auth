---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: the one-time token verify endpoint is
`auth.api.verifyCrossDomainOneTimeToken`, the key upstream 0.13.0 uses, instead
of `crossDomainVerifyOneTimeToken`. The path
(`/cross-domain/one-time-token/verify`), the storage and the client are
unchanged, so only code calling the endpoint through `auth.api` needs the new
name.

The old key isn't kept as an alias. Two keys for the same path make Better
Auth's `checkEndpointConflicts` log a path conflict on every start, and the
client would infer the endpoint twice. Matching upstream's name keeps code
portable between the fork and `@convex-dev/better-auth`.
