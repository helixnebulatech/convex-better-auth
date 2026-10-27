---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain client: read the referrer policy from the last meta tag, and add
only one with `setReferrerPolicy`.

The warning about a referrer policy that makes OAuth sign-in fail read the first
`<meta name="referrer">`, but the last one inserted sets the page's policy. With
`setReferrerPolicy: true`, every sign-in added another meta tag. It now reuses
its own tag and moves it last.
