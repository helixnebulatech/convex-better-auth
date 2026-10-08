---
"@helixnebulatech/convex-better-auth": patch
---

Match optional fields that were never written against `eq null` / `ne null` where clauses, so Better Auth atomic updates such as the two factor lockout no longer fail on them
