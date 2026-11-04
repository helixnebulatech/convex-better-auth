---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: `trustedOrigins` entries containing `?` no longer count as exact
origins. Better Auth treats `?` as a wildcard (`matchesOriginPattern`), but the
plugin parsed the entry as a URL, so `https://app?.example.com` became the exact
origin `https://app`, which Better Auth never trusts, for starting an OAuth flow
and receiving its session. The component's request origin check already skips
them; both now leave out `*` and `?` entries.
