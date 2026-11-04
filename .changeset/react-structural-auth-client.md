---
"@helixnebulatech/convex-better-auth": patch
---

React: `ConvexBetterAuthProvider` and `AuthBoundary` accept any Better Auth
React client created with `convexClient()`, whatever its other plugins.
`AuthClient` was derived from `createAuthClient()` with a fixed plugin list, so
a client with `inferAdditionalFields()` failed with TS2322. It now describes
only the parts the component calls, as upstream 0.13.0 does, and the new
`AuthClientWithCrossDomain` type adds the cross domain ones.

Upstream's version types the token and one-time token calls as `any`. Ours keeps
their argument and result shapes, so it is not looser than before: a client
without `convexClient()` is still rejected, with or without
`crossDomainClient()`.
