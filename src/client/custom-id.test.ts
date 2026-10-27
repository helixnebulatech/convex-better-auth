/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";
import { createSchema } from "./create-schema.js";

const BASE = "http://localhost:3000/api/auth";

// Better Auth 1.7.8+ creates some rows with an id it chooses (forceAllowId)
// and relies on the primary key to reject a second row with the same id, as
// the Drizzle, Prisma, Kysely and MongoDB adapters do. Convex picks _id
// itself, so the adapter keeps the chosen id in customId and enforces it.
describe("ids chosen by Better Auth", () => {
  const setup = (generateId?: "uuid") => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const client = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    });
    const magicLinks: string[] = [];
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "custom-id-test-secret-at-least-32-characters",
      database: client.adapter(ctx),
      emailAndPassword: { enabled: true },
      logger: { disabled: true },
      ...(generateId ? { advanced: { database: { generateId } } } : {}),
      plugins: [
        magicLink({
          sendMagicLink: async ({ url }) => {
            magicLinks.push(url);
          },
        }),
      ],
    });
    return { auth, magicLinks };
  };

  const verificationRow = {
    identifier: "lock:user-1",
    value: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it("rejects a second row with the same id, like a primary key", async () => {
    const { auth } = setup();
    const { adapter } = await auth.$context;
    const chosenId = "Zm9yY2VkLWlkLWZvci10aGUtcmVzZXJ2YXRpb24tdGVzdA";
    const created = await adapter.create<{ id: string }>({
      model: "verification",
      data: { ...verificationRow, id: chosenId },
      forceAllowId: true,
    });
    await expect(
      adapter.create({
        model: "verification",
        data: { ...verificationRow, id: chosenId },
        forceAllowId: true,
      })
    ).rejects.toThrow(/already exists/);

    // Found by the chosen id, returned with its Convex id, without customId
    const found = await adapter.findOne<Record<string, unknown>>({
      model: "verification",
      where: [{ field: "id", value: chosenId }],
    });
    expect(found).toMatchObject({ id: created.id, value: "user-1" });
    expect(found).not.toHaveProperty("customId");

    // Deleting the row frees the id
    await adapter.delete({
      model: "verification",
      where: [{ field: "id", value: chosenId }],
    });
    expect(
      await adapter.findOne({
        model: "verification",
        where: [{ field: "id", value: chosenId }],
      })
    ).toBeNull();
    await adapter.create({
      model: "verification",
      data: { ...verificationRow, id: chosenId },
      forceAllowId: true,
    });
  });

  // Better Auth derives a UUID for the chosen id in this mode, which the SQL
  // adapters keep as the primary key
  for (const generateId of [undefined, "uuid"] as const) {
    it(`reserves a verification value once${generateId ? ` with generateId: ${generateId}` : ""}`, async () => {
      const { auth } = setup(generateId);
      const { internalAdapter } = await auth.$context;
      const reserve = () =>
        internalAdapter.reserveVerificationValue({
          identifier: "siwe-email-claim-a@example.com",
          value: "0xabc",
          expiresAt: new Date(Date.now() + 60_000),
        });
      expect(await reserve()).toBe(true);
      expect(await reserve()).toBe(false);
      await internalAdapter.deleteVerificationByIdentifier(
        "siwe-email-claim-a@example.com"
      );
      expect(await reserve()).toBe(true);
    });
  }

  it("fails closed on a table without customId", async () => {
    const { auth } = setup();
    const { adapter } = await auth.$context;
    await expect(
      adapter.create({
        model: "user",
        data: {
          id: "chosen-user-id",
          name: "A",
          email: "a@example.com",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        forceAllowId: true,
      })
    ).rejects.toThrow(/no customId field/);
  });

  // Better Auth 1.7.8+ revokes the accounts and sessions an unverified user
  // had before proving the email, guarded by reserveVerificationValue.
  it("signs in an unverified user with a magic link", async () => {
    const { auth, magicLinks } = setup();
    const signUp = await auth.handler(
      new Request(`${BASE}/sign-up/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "unverified@example.com",
          password: "password-1234",
          name: "Unverified",
        }),
      })
    );
    expect(signUp.status).toBe(200);
    const { user, token: oldSessionToken } = await signUp.json();
    expect(user.emailVerified).toBe(false);
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.findAccounts(user.id)).toHaveLength(1);

    const sent = await auth.handler(
      new Request(`${BASE}/sign-in/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "unverified@example.com" }),
      })
    );
    expect(sent.status).toBe(200);
    expect(magicLinks).toHaveLength(1);

    const verified = await auth.handler(new Request(magicLinks[0]!));
    expect(verified.status).toBe(302);
    expect(verified.headers.get("location")).not.toContain("error");
    expect(verified.headers.get("set-cookie")).toContain(
      "better-auth.session_token="
    );

    // Promoted: email verified, the password account and the old session
    // from before the proof are gone, and the lock was released.
    expect(await ctx.internalAdapter.findUserById(user.id)).toMatchObject({
      emailVerified: true,
    });
    expect(await ctx.internalAdapter.findAccounts(user.id)).toHaveLength(0);
    expect(await ctx.internalAdapter.findSession(oldSessionToken)).toBeNull();
    expect(
      await ctx.internalAdapter.findVerificationValue(
        `revoke-unproven-account-access:${user.id}`
      )
    ).toBeNull();
  });

  it("generates customId for the tables that need it", async () => {
    const { code } = await createSchema({
      tables: {
        verification: {
          modelName: "verification",
          fields: {
            identifier: { type: "string", required: true },
            expiresAt: { type: "date", required: true },
          },
        },
        // OAuth provider plugin, private_key_jwt replay check
        oauthClientAssertion: {
          modelName: "oauthClientAssertion",
          fields: { expiresAt: { type: "date", required: true } },
        },
        session: {
          modelName: "session",
          fields: { token: { type: "string", required: true } },
        },
      },
    });
    // Each table definition runs until the next one, or the end of tables
    const table = (name: string) =>
      code
        .slice(code.indexOf(`  ${name}: defineTable`))
        .split(/\n {2}\w+: defineTable|\n};/)[0]!;
    for (const name of ["verification", "oauthClientAssertion"]) {
      expect(table(name)).toContain("customId: v.optional(v.string()),");
      expect(table(name)).toContain('.index("customId", ["customId"])');
    }
    expect(table("session")).not.toContain("customId");
  });
});
