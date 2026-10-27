---
"@helixnebulatech/convex-better-auth": patch
---

Next.js and TanStack Start handlers: drop hop-by-hop request headers before
forwarding to Convex.

The handlers removed `transfer-encoding`, `content-length` and `connection` from
the request they forward, but kept `expect`, `keep-alive` and `upgrade`, which
Node's fetch rejects. A request carrying one of them, for example a large POST
from curl, which sends `Expect: 100-continue`, failed with a 500. The handlers
now drop every hop-by-hop header (RFC 9110 section 7.6.1), the ones listed in
`Connection`, and `expect`, as they already did for the response.
