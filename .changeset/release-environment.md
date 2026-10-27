---
"@helixnebulatech/convex-better-auth": patch
---

Release workflow: publishing runs in the protected `Release` environment, and a
manual normal release only runs from `main`, like Better Auth's release
workflow. Vercel's AI SDK workflow, which ours started from, has neither, so a
collaborator or a leaked token could run it on an unreviewed branch and publish
it with valid provenance. Only the environment, required by npm trusted
publishing, stops this, as a branch can edit the workflow's own checks.
