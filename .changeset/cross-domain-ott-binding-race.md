---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain: close a race that let an OAuth one-time token be redeemed without
the browser's verifier.

An OAuth one-time token is bound to the verifier of the browser that started the
flow. Redeeming it deleted that binding before consuming the token, and issuing
it created the token before the binding. In either gap, a request with only the
token, for example from a leaked URL, found no binding and could take the
session. The binding is now created before the token and deleted only after the
token is consumed, so the token is never redeemable without it.
