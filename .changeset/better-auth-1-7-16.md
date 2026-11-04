---
"@helixnebulatech/convex-better-auth": patch
---

The `better-auth` peer range is now `>=1.7.16 <1.8.0`, up from `>=1.7.5`. Better
Auth 1.7.16 has security fixes, and the component is tested with it. Apps on
Better Auth 1.7.5 to 1.7.15 must upgrade it with this release, or npm (and pnpm
with strict peer dependencies) refuses the install: `better-auth@~1.7.16`. Apps
already on 1.7.16 or later don't need to change anything.
