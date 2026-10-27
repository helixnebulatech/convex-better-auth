---
"@helixnebulatech/convex-better-auth": patch
---

Schema generation: `connectionId_orderKey` indexes on `scimUser` and
`scimGroup`.

The SCIM plugin lists a connection's users and groups sorted by `orderKey`. With
an index on `connectionId` and another on `orderKey` but none on both, each page
read every user or group of the connection. Local Install apps with the SCIM
plugin get the indexes when they regenerate their schema.
