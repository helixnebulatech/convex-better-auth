---
"@helixnebulatech/convex-better-auth": patch
---

Apply AND where clauses combined with OR clauses in `findOne`, `findMany`, `count`, `updateMany` and `deleteMany` instead of dropping them, and return null from `findOne` when no OR clause matches
