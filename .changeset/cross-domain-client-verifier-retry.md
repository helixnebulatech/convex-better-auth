---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain client: keep the OAuth verifier until a one-time token is redeemed.

`crossDomainClient` sent the stored verifier with every one-time token
redemption and cleared it before the response arrived. If the redemption failed,
for example on a network error, a retry had no verifier and the OAuth sign-in
failed with "Invalid token". The verifier is now cleared only after a successful
redemption.
