---
"@helixnebulatech/convex-better-auth": patch
---

Adapter: `updateMany` updates each matching row once. It patched rows while
paginating the index its `where` filters on, so an update that moved a row past
the cursor, such as extending `expiresAt` of sessions selected by
`expiresAt gt`, read the row again on the next page and patched it, counted it
and fired its `onUpdate` trigger twice. It now collects the matching ids first
and updates them in chunks of 200, with the original `where` applied again in
each chunk so a row that stopped matching in between is left alone. This is
what SQL's `UPDATE ... WHERE` does in Better Auth's Kysely, Drizzle and Prisma
adapters: every row that matches when the statement runs is updated once.
Upstream made the same change. Paginating in creation order instead would avoid
the moving rows but give up the index and scan the whole table. `deleteMany` keeps paginating: a deleted
row can't come back after the cursor.
