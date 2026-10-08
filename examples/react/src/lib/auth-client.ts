import { createAuthClient } from "better-auth/react";
import {
  convexClient,
  crossDomainClient,
} from "@convex-dev/better-auth/client/plugins";
import { magicLinkClient, emailOTPClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    crossDomainClient({
      // e2e only: lets tests opt in to setReferrerPolicy
      setReferrerPolicy:
        import.meta.env.VITE_MOCK_OAUTH === "true" &&
        (globalThis as { __E2E_SET_REFERRER_POLICY?: boolean })
          .__E2E_SET_REFERRER_POLICY === true,
    }),
    convexClient(),
  ],
});
