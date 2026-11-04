---
"@helixnebulatech/convex-better-auth": patch
---

Query context: `consumeOne` and `incrementOne` returned `null` in a query, as if
no row matched. `@better-auth/api-key` retries its rate limit update with a
fresh row on a miss (`consumeRateLimit`), so `verifyApiKey` from a query, with
rate limiting on by default, recursed until the heap ran out. They now throw an
error that names the method and the endpoint. The other writes stay no-ops with
a warning, since their callers don't depend on them, but an atomic write decides
what the caller does next: returning the row would accept a one-time token or a
rate limited request without recording it, and a miss makes callers retry or
report the wrong error. Upstream 0.13.0 reverted the same no-ops and lets the
adapter throw; the component throws from the plugin instead, so the error is
the same with any adapter and says what to do.
