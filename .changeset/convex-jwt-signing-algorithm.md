---
"@helixnebulatech/convex-better-auth": patch
---

Convex plugin: always sign the Convex JWT with the algorithm in the Convex auth
config, and leave other plugins' keys alone.

The Convex plugin and Better Auth's `jwt` plugin, which `oauthProvider`
requires, keep their keys in the same `jwks` table. Without a pinned algorithm,
Better Auth signs with the latest key of any algorithm when there's none in the
configured one. So if the `jwt` plugin created the first key, the Convex JWT was
signed with EdDSA, which Convex rejects since its auth config expects RS256, and
nobody could sign in to Convex. Also, `rotateKeys` and
`jwksRotateOnTokenGenerationError` deleted every key in the table, including the
`jwt` plugin's, and `getLatestJwks` could export the `jwt` plugin's key labelled
as RS256.

Now:

- The JWT is signed with `signingAlgorithm` set to the configured algorithm, so
  Better Auth uses or creates a key of that algorithm.
- `/convex/jwks` publishes only the keys of that algorithm.
- `rotateKeys`, `getLatestJwks` and `jwksRotateOnTokenGenerationError` only use
  and delete those keys.

Keys without an `alg`, saved before Better Auth added the column, count as the
configured algorithm, as in Better Auth.

Why this option: Better Auth's `oauthProvider` pins `signingAlgorithm` when an
audience needs a specific algorithm, and Better Auth then picks or creates a key
of that algorithm, which is what Convex needs. Publishing only those keys is
stricter than Better Auth's `jwt` plugin, which publishes every key, since
Convex only accepts one algorithm.
