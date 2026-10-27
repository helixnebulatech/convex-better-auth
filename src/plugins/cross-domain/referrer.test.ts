// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthClient } from "better-auth/client";
import { betterAuth } from "better-auth/minimal";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { crossDomain } from "./index.js";
import { crossDomainClient } from "./client.js";

const AUTH = "https://deploy.convex.site";
const SITE = "https://app.example.com";

const setup = (setReferrerPolicy: boolean) => {
  const auth = betterAuth({
    baseURL: AUTH,
    secret: "referrer-test-secret-at-least-32-characters",
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    trustedOrigins: [SITE],
    logger: { disabled: true },
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: "mock",
            clientId: "c",
            clientSecret: "s",
            authorizationUrl: "https://provider.example.com/authorize",
          },
        ],
      }),
      crossDomain({ siteUrl: SITE }),
    ],
  });
  const items = new Map<string, string>();
  const client = createAuthClient({
    baseURL: `${AUTH}/api/auth`,
    plugins: [
      crossDomainClient({
        setReferrerPolicy,
        storage: {
          getItem: (key) => items.get(key) ?? null,
          setItem: (key, value) => {
            items.set(key, value);
          },
        },
      }),
    ],
    fetchOptions: {
      customFetchImpl: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("origin", SITE);
        return auth.handler(new Request(input, { ...init, headers }));
      },
    },
  });
  const signIn = () =>
    client.$fetch("/sign-in/social", {
      method: "POST",
      body: { provider: "mock", callbackURL: SITE },
    });
  return { signIn };
};

const addMeta = (content: string) => {
  const meta = document.createElement("meta");
  meta.name = "referrer";
  meta.content = content;
  document.head.appendChild(meta);
};

describe("crossDomainClient referrer policy", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    // The form POST would navigate away
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds one meta tag, kept last, however many sign-ins", async () => {
    const { signIn } = setup(true);
    addMeta("no-referrer");
    await signIn();
    addMeta("same-origin");
    await signIn();
    const tags = document.head.querySelectorAll('meta[name="referrer"]');
    expect(
      document.head.querySelectorAll("meta[data-better-auth]")
    ).toHaveLength(1);
    expect(tags[tags.length - 1]!.getAttribute("content")).toBe(
      "strict-origin-when-cross-origin"
    );
  });

  it("warns about the last referrer meta tag, which sets the policy", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { signIn } = setup(false);
    addMeta("strict-origin-when-cross-origin");
    addMeta("no-referrer");
    await signIn();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain('"no-referrer"');
  });

  it("doesn't warn when the last tag sends the origin", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { signIn } = setup(false);
    addMeta("no-referrer");
    addMeta("strict-origin-when-cross-origin");
    await signIn();
    expect(warn).not.toHaveBeenCalled();
  });
});
