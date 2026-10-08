---
"@helixnebulatech/convex-better-auth": patch
---

Strip hop-by-hop headers such as `connection: keep-alive` from proxied auth responses in the Next.js and TanStack Start handlers, fixing empty 400 responses for clients that send `Connection: close`.
