---
"@helixnebulatech/convex-better-auth": patch
---

Release workflow: only the job that publishes runs in the protected `Release`
environment, with read-only contents and the npm OIDC token. Opening the
"Version Packages" pull request and creating the GitHub release run in separate
jobs outside it, and the optional auto-merge with a personal token is gone.
