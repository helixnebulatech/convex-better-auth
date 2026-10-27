---
"@helixnebulatech/convex-better-auth": patch
---

Order the equality fields of table-level indexes the same way in the schema
generator and in the adapter.

The generator sorted the fields of the table-level indexes Better Auth declares
by code unit, and the adapter looked equality fields up in `localeCompare`
order. They differ when field names differ only by case, such as `orgId` and
`organizationId`, so the adapter didn't find the generated index and scanned the
table. Both now use code unit order, which doesn't depend on the locale. No
index Better Auth 1.7 or the generated schemas declare today changes order.
