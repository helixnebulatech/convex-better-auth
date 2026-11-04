---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: native `incrementOne`, and `consumeOne` and `incrementOne` component
functions in `createApi`, with upstream's arguments. Better Auth 1.7 updates
rate limit rows, two factor lockouts and organization team seats with
`incrementOne`. Without a native one, Better Auth reads the row and updates it
with a compare-and-swap `updateMany`, retried 5 times, so concurrent requests on
the same row could fail with "could not complete an atomic increment due to
contention". The component's `incrementOne` reads, checks and writes the row in
one mutation, which Convex runs as a transaction, as Better Auth's Kysely
adapter does in one `UPDATE ... WHERE`. An unset or null counter counts as 0, as
in Better Auth's memory adapter and atomic fallback (SQL would leave it null),
and the `where` keeps the SQL null semantics of every other query, so a guard
like `count lt 5` never matches a null count; upstream needs extra `ne null`
guards for that, ours doesn't.

The client adapter keeps consuming rows with `deleteOne`, which finds and
deletes the row in one mutation too, so it's as atomic as the new `consumeOne`
and keeps working with every Local Install. For `incrementOne` there is no
existing function to fall back on, so when a Local Install's `adapter.ts`
doesn't export it yet, the adapter catches Convex's "Could not find function"
error, logs a warning and runs Better Auth's compare-and-swap fallback itself,
instead of breaking rate limiting for apps that haven't updated their
`adapter.ts`. `createClient` accepts a component without the two functions, and
an `adapter.ts` written for upstream, which exports them, typechecks.
