import { describe, expect, it } from "vitest";
import { createPublicJwks } from "./auth-config.js";

const key = (id: string, expiresAt?: number) => ({
  id,
  publicKey: JSON.stringify({ kty: "RSA", n: "n", e: "AQAB" }),
  privateKey: "",
  createdAt: 0,
  alg: "RS256",
  ...(expiresAt !== undefined ? { expiresAt } : {}),
});

describe("createPublicJwks", () => {
  // Like Better Auth's jwks endpoint, which drops keys past expiresAt plus
  // the grace period (30 days by default)
  it("drops keys past their expiry and grace period", () => {
    const day = 24 * 60 * 60 * 1000;
    const { keys } = createPublicJwks([
      key("no-expiry"),
      key("expired-in-grace", Date.now() - day),
      key("expired", Date.now() - 31 * day),
    ]);
    expect(keys.map((k) => k.kid)).toEqual(["no-expiry", "expired-in-grace"]);
  });
});
