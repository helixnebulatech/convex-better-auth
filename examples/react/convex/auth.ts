import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex, crossDomain } from "@convex-dev/better-auth/plugins";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import { components } from "./_generated/api";
import { query } from "./_generated/server";
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { magicLink } from "better-auth/plugins/magic-link";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { DataModel } from "./_generated/dataModel";
import {
  sendEmailVerification,
  sendMagicLink,
  sendOTPVerification,
  sendResetPassword,
} from "./email";
import authConfig from "./auth.config";

const siteUrl = process.env.SITE_URL!;

// e2e only: a mock OAuth provider (e2e/mock-oauth-provider.mjs) to test the
// cross-domain OAuth flow in real browsers.
const mockOAuthUrl =
  process.env.IS_TEST === "true" ? process.env.MOCK_OAUTH_URL : undefined;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  verbose: false,
});

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmailVerification(requireActionCtx(ctx), {
          to: user.email,
          url,
        });
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: process.env.IS_TEST !== "true",
      sendResetPassword: async ({ user, url }) => {
        await sendResetPassword(requireActionCtx(ctx), {
          to: user.email,
          url,
        });
      },
    },
    socialProviders: {
      ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: process.env.GITHUB_CLIENT_ID,
              clientSecret: process.env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    user: {
      deleteUser: {
        enabled: true,
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLink(requireActionCtx(ctx), {
            to: email,
            url,
          });
        },
      }),
      emailOTP({
        async sendVerificationOTP({ email, otp }) {
          await sendOTPVerification(requireActionCtx(ctx), {
            to: email,
            code: otp,
          });
        },
      }),
      crossDomain({ siteUrl }),
      convex({ authConfig }),
      ...(mockOAuthUrl
        ? [
            genericOAuth({
              config: [
                {
                  providerId: "mock",
                  clientId: "e2e-client",
                  clientSecret: "e2e-secret",
                  authorizationUrl: `${mockOAuthUrl}/authorize`,
                  tokenUrl: `${mockOAuthUrl}/token`,
                  userInfoUrl: `${mockOAuthUrl}/userinfo`,
                  scopes: ["profile", "email"],
                },
              ],
            }),
          ]
        : []),
    ],
    account: {
      accountLinking: {
        enabled: true,
      },
    },
  }) satisfies BetterAuthOptions;

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));

// Example function for getting the current user
export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    return await authComponent.getAuthUser(ctx);
  },
});
