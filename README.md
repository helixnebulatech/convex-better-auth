# Convex + Better Auth

> [!NOTE]
>
> **This is a community fork maintained by
> [Helix Nebula](https://helixnebula.tech)**, published as
> [`@helixnebulatech/convex-better-auth`](https://www.npmjs.com/package/@helixnebulatech/convex-better-auth).
> It is not an official Convex package. The official component is
> [`@convex-dev/better-auth`](https://github.com/get-convex/better-auth).

## About this fork

### Why it exists

Better Auth ships quickly, and the official Convex component needs time to catch
up with each release. While it supported only Better Auth 1.6.x, we wanted to
use 1.7.x in our own apps. This fork tracks the latest Better Auth release so
that we do not have to wait.

It starts from upstream `0.12.5` and the Better Auth 1.7 work in
[get-convex/better-auth#444](https://github.com/get-convex/better-auth/pull/444),
with fixes for issues we found while testing against Better Auth 1.7.7. It also
includes the bug fixes from the open upstream pull requests, each verified with
a reproduction test before it was taken. See [FORK.md](./FORK.md) for the full
list of differences from upstream.

### Who we are

[Helix Nebula](https://helixnebula.tech) designs custom privacy and
cybersecurity solutions and builds software. We use Convex and Better Auth in
production for our own projects, and we run this fork in all of them.

### Use it

Install it with a package alias, so your existing `@convex-dev/better-auth`
imports keep working:

```sh
# npm
npm install @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.2 better-auth@~1.7.7
# pnpm
pnpm add @convex-dev/better-auth@npm:@helixnebulatech/convex-better-auth@^0.13.2 better-auth@~1.7.7
```

Then follow the
[0.13 migration guide](./docs/content/docs/migrations/migrate-to-0-13.mdx).
Everything else in this README and in the
[official docs](https://labs.convex.dev/better-auth) still applies.

### Maintenance and contributing

We keep this fork up to date with new Better Auth releases and merge upstream
changes regularly. When the official component catches up, we send our fixes
upstream where they help.

Anyone is welcome to use it. If you find a bug or need a newer Better Auth
version, feel free to
[open an issue](https://github.com/helixnebulatech/convex-better-auth/issues) or
a pull request. Issues that also affect the official component are best reported
[upstream](https://github.com/get-convex/better-auth/issues) as well.

### Thanks

A big thank you to the [Convex](https://www.convex.dev) team for building and
maintaining the Better Auth component, and for releasing it as open source. This
fork exists only because of their work. Thanks as well to the authors of the
upstream pull requests that made the Better Auth 1.7 upgrade possible, and to
the [Better Auth](https://better-auth.com) team.

---

<!-- START: Include on https://convex.dev/components -->

Use [Better Auth](https://better-auth.com) with
[Convex](https://www.convex.dev).

**Full documentation and guides:
[labs.convex.dev/better-auth](https://labs.convex.dev/better-auth)**

### Framework Agnostic

**Support for popular frameworks.**

Supports popular frameworks, including React, Vue, Svelte, Astro, Solid,
Next.js, Nuxt, Tanstack Start, Hono, and more.

### Authentication

**Email & Password Authentication.**

Built-in support for email and password authentication, with session and account
management features.

### Social Sign-on

**Support multiple OAuth providers.**

Allow users to sign in with their accounts, including GitHub, Google, Discord,
Twitter, and more.

### Two Factor

**Multi Factor Authentication.**

Secure your users accounts with two factor authentication with a few lines of
code.

<!-- END: Include on https://convex.dev/components -->
