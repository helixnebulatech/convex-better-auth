---
"@helixnebulatech/convex-better-auth": patch
---

Add a `lastRequest` index to the `rateLimit` table so pruning expired rate limit rows no longer scans the whole table. Local installs pick it up by regenerating their schema.
