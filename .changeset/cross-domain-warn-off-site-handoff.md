---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: when a magic link or email verification link redirects to an
origin other than `siteUrl`, the plugin logs a warning with both origins instead
of redirecting without a session silently, as it already did for an OAuth
callback on another origin than the one that started the flow. Upstream logs a
similar warning. Tokens aren't logged.
