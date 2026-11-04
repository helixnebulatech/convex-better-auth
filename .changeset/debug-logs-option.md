---
"@helixnebulatech/convex-better-auth": patch
---

`createClient(component, { debugLogs })`: Better Auth's adapter debug logs have
their own option, with the type of the `debugLogs` of Better Auth's adapters
(`DBAdapterDebugLogOption`), as in upstream 0.13.0. `verbose` turned them on,
and they print whole database rows without redaction, including session tokens,
password hashes and verification values, so turning on verbose header logs,
which redact credentials, also put credentials in the deployment logs.

Behaviour change: `verbose: true` no longer prints adapter debug logs. Add
`debugLogs: true` while debugging to get them back. Upstream made the same
change. Keeping `verbose` as a switch for both would leave the one option that
looks safe to enable the one that leaks secrets.
