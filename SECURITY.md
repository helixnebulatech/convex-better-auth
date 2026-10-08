# Security policy

## Supported versions

Security fixes are released for the latest version of
`@helixnebulatech/convex-better-auth` only. Upgrade to the latest release to get
them.

| Version         | Supported |
| --------------- | --------- |
| Latest `0.13.x` | Yes       |
| Older versions  | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/helixnebulatech/convex-better-auth/security/advisories/new).
Do not open a public issue, pull request or discussion for a vulnerability.

Include as much of this as you can:

- The affected version, and the Better Auth and Convex versions.
- The setup needed to reproduce it, for example the plugins, the framework, and
  whether you use the cross domain plugin or Local Install.
- Steps to reproduce, or a proof of concept.
- The impact you expect, and any fix you have in mind.

We aim to acknowledge reports within 3 business days and to keep you updated
until a fix is released. Once it is, we publish a GitHub security advisory and
credit you, unless you prefer to stay anonymous.

## Upstream and dependencies

This package is a fork of
[`@convex-dev/better-auth`](https://github.com/get-convex/better-auth). If a
vulnerability also affects the official component, we report it to the Convex
team privately as well, and coordinate the disclosure with them.

Vulnerabilities in Better Auth or Convex themselves should be reported to those
projects:

- [Better Auth security policy](https://github.com/better-auth/better-auth/security)
- [Convex security](https://www.convex.dev/security)

## Security notes

The [security notes](./docs/content/docs/security.mdx) in the docs describe how
the component behaves compared to Better Auth, and what to watch for when you
configure it.
