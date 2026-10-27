import { describe, expect, it } from "vitest";
import type { BetterAuthPlugin } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { anonymous } from "better-auth/plugins/anonymous";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { emailOTP } from "better-auth/plugins/email-otp";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { multiSession } from "better-auth/plugins/multi-session";
import { oAuthProxy } from "better-auth/plugins/oauth-proxy";
import { oneTap } from "better-auth/plugins/one-tap";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { openAPI } from "better-auth/plugins/open-api";
import { organization } from "better-auth/plugins/organization";
import { phoneNumber } from "better-auth/plugins/phone-number";
import { siwe } from "better-auth/plugins/siwe";
import { twoFactor } from "better-auth/plugins/two-factor";
import { username } from "better-auth/plugins/username";
import { oauthPopup } from "better-auth/plugins";
import { convex } from "./convex/index.js";
import { crossDomain } from "./cross-domain/index.js";

// Better Auth merges the endpoints of every plugin by key, and the plugin
// registered last silently replaces an endpoint with the same key. Its own
// plugins use keys of their own, so ours must too.
const officialPlugins: BetterAuthPlugin[] = [
  admin(),
  anonymous(),
  bearer(),
  deviceAuthorization(),
  emailOTP({ sendVerificationOTP: async () => {} }),
  genericOAuth({ config: [] }),
  jwt(),
  magicLink({ sendMagicLink: async () => {} }),
  multiSession(),
  oauthPopup(),
  oAuthProxy(),
  oneTap(),
  oneTimeToken(),
  openAPI(),
  organization(),
  phoneNumber({ sendOTP: async () => {} }),
  siwe({
    domain: "example.com",
    getNonce: async () => "nonce",
    verifyMessage: async () => true,
  }),
  twoFactor(),
  username(),
];

// Official plugins published as separate packages, which aren't
// dependencies here. Keys from their 1.7.13 releases.
const separatePackageKeys = {
  "@better-auth/oauth-provider": ["getOpenIdConfig", "getOAuthServerConfig"],
  "@better-auth/expo": ["expoAuthorizationProxy"],
  "@better-auth/passkey": ["listPasskeys", "deletePasskey", "updatePasskey"],
};

describe("plugin endpoint keys", () => {
  const official = new Map<string, string>();
  for (const plugin of officialPlugins) {
    for (const key of Object.keys(plugin.endpoints ?? {})) {
      official.set(key, plugin.id);
    }
  }
  for (const [pkg, keys] of Object.entries(separatePackageKeys)) {
    for (const key of keys) {
      official.set(key, pkg);
    }
  }

  const ours = {
    convex: convex({
      authConfig: {
        providers: [{ applicationID: "convex", domain: "https://example.com" }],
      },
    }),
    crossDomain: crossDomain({ siteUrl: "https://app.example.com" }),
  };

  for (const [name, plugin] of Object.entries(ours)) {
    it(`${name} doesn't share an endpoint key with Better Auth's plugins`, () => {
      const shared = Object.keys(plugin.endpoints).flatMap((key) =>
        official.has(key) ? [`${key} (${official.get(key)})`] : []
      );
      expect(shared).toEqual([]);
    });
  }

  it("covers the keys that used to collide", () => {
    for (const key of [
      "verifyOneTimeToken",
      "getToken",
      "getJwks",
      "getOpenIdConfig",
    ]) {
      expect(official.has(key)).toBe(true);
    }
  });
});
