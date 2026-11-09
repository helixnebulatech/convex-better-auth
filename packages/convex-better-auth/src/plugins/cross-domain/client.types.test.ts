import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { expectTypeOf, it } from "vitest";
import { convexClient } from "../convex/client.js";
import { crossDomainClient } from "./client.js";

const storage = {
  getItem: () => null,
  setItem: () => undefined,
};

it("composes with Better Auth client plugins and infers cross-domain actions", () => {
  const authClient = createAuthClient({
    baseURL: "http://localhost:3000",
    plugins: [convexClient(), crossDomainClient({ storage }), adminClient()],
  });

  expectTypeOf(authClient.getCookie).toEqualTypeOf<() => string>();
  expectTypeOf(authClient.startOAuthRedirect).toEqualTypeOf<
    (url: string) => Promise<void>
  >();
  // Inferred from the server plugin's endpoint path
  expectTypeOf(authClient.crossDomain.oneTimeToken.verify).toBeFunction();
  // Type checked, not run: the client calls it with the token, and with the
  // verifier of the browser that started an OAuth flow
  const redeem = async () => {
    const { data } = await authClient.crossDomain.oneTimeToken.verify({
      token: "token",
    });
    await authClient.crossDomain.oneTimeToken.verify({
      token: "token",
      verifier: "verifier",
    });
    return data?.session.token;
  };
  expectTypeOf(redeem).returns.resolves.toEqualTypeOf<string | undefined>();
});
