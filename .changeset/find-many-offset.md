---
"@helixnebulatech/convex-better-auth": patch
---

Support `offset` in `findMany`, so paging such as the admin plugin's `listUsers` and the organization plugin's `listMembers` no longer fails (admin `listUsers` returned an empty list)
