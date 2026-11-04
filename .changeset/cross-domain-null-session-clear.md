---
"@helixnebulatech/convex-better-auth": patch
---

Cross domain client: when `get-session` returns null, the stored session is
cleared unless the session token cookie itself changed while the request was in
flight. Before, any change to the stored cookies kept it, so a stale session
token, `session_data` and `convex_jwt` stayed in storage when an unrelated
cookie changed meanwhile, such as a new `two_factor` challenge or a stored
cookie expiring between the request and the response.

This matches upstream 0.13.0, which compares only the session token. Ours
matches the cookie name rather than a `.session_token=` substring, so it also
works without a cookie prefix and ignores multi session cookies.
