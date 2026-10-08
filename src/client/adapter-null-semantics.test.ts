/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { twoFactor } from "better-auth/plugins/two-factor";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

// Null semantics of Better Auth's SQL adapters (Kysely, Drizzle, Prisma):
// comparisons with NULL are never true, so lt/lte/gt/gte, ne and not_in skip
// rows where the field is null (or, in Convex, was never written), and a null
// comparison value matches nothing. Only eq/ne null (IS NULL / IS NOT NULL)
// match on null.
describe("null semantics of where clauses", () => {
  const setup = () =>
    convexTest(schema, import.meta.glob("../component/**/*.*s"));

  const findMany = async (
    t: ReturnType<typeof setup>,
    model: "jwks" | "user",
    where: any[]
  ) =>
    (
      await t.query(api.adapter.findMany, {
        model,
        where,
        paginationOpts: { numItems: 20, cursor: null },
      })
    ).page;

  // jwks.expiresAt is optional and has no index: clauses apply statically.
  const seedJwks = (t: ReturnType<typeof setup>) =>
    t.run(async (ctx) => {
      const base = { privateKey: "p", createdAt: 1 };
      await ctx.db.insert("jwks", { ...base, publicKey: "unset" });
      await ctx.db.insert("jwks", { ...base, publicKey: "null", expiresAt: null });
      await ctx.db.insert("jwks", { ...base, publicKey: "low", expiresAt: 5 });
      await ctx.db.insert("jwks", { ...base, publicKey: "high", expiresAt: 500 });
    });
  const keys = (page: any[]) => page.map((doc) => doc.publicKey).sort();

  it.each([
    ["lt", 100, ["low"]],
    ["lte", 5, ["low"]],
    ["gt", 100, ["high"]],
    ["gte", 500, ["high"]],
    ["lt", null, []],
    ["lte", null, []],
    ["gt", null, []],
    ["gte", null, []],
    ["ne", 5, ["high"]],
    ["ne", null, ["high", "low"]],
    ["eq", null, ["null", "unset"]],
    ["not_in", [5], ["high"]],
  ] as const)(
    "static filter: %s %j",
    async (operator, value, expected) => {
      const t = setup();
      await seedJwks(t);
      expect(
        keys(await findMany(t, "jwks", [{ field: "expiresAt", operator, value }]))
      ).toEqual(expected);
    }
  );

  // user.userId is optional and indexed: range clauses use an index range.
  const seedUsers = (t: ReturnType<typeof setup>) =>
    t.run(async (ctx) => {
      const base = { emailVerified: false, createdAt: 1, updatedAt: 1 };
      await ctx.db.insert("user", { ...base, name: "unset", email: "1@x.com" });
      await ctx.db.insert("user", {
        ...base,
        name: "null",
        email: "2@x.com",
        userId: null,
      });
      await ctx.db.insert("user", {
        ...base,
        name: "low",
        email: "3@x.com",
        userId: "a",
      });
      await ctx.db.insert("user", {
        ...base,
        name: "high",
        email: "4@x.com",
        userId: "z",
      });
    });
  const names = (page: any[]) => page.map((doc) => doc.name).sort();

  it.each([
    ["lt", "m", ["low"]],
    ["lte", "a", ["low"]],
    ["gt", "m", ["high"]],
    ["gte", "a", ["high", "low"]],
    ["lt", null, []],
    ["lte", null, []],
    ["gt", null, []],
    ["gte", null, []],
    ["ne", "a", ["high"]],
    ["not_in", ["a"], ["high"]],
  ] as const)("index range: %s %j", async (operator, value, expected) => {
    const t = setup();
    await seedUsers(t);
    expect(
      names(await findMany(t, "user", [{ field: "userId", operator, value }]))
    ).toEqual(expected);
  });

  it("deleteMany lt leaves rows with a null or unset field", async () => {
    const t = setup();
    await seedUsers(t);
    const result = await t.mutation(api.adapter.deleteMany, {
      input: {
        model: "user",
        where: [{ field: "userId", operator: "lt", value: "m" }],
      },
      paginationOpts: { numItems: 20, cursor: null },
    });
    expect(result.count).toBe(1);
    expect(
      names(await t.run(async (ctx) => ctx.db.query("user").collect()))
    ).toEqual(["high", "null", "unset"]);
  });

  // Better Auth 1.7.7's two factor plugin clears an expired lock with this
  // guarded write. A request holding a stale snapshot must not reset the
  // failure count of a row whose lock was already cleared (lockedUntil null).
  it("two factor lock reset guard misses a cleared lock", async () => {
    const t = setup();
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({ plugins: [twoFactor()] });
    const base = { secret: "s", backupCodes: "[]", failedVerificationCount: 7 };
    const ids = await t.run(async (ctx) => ({
      unset: await ctx.db.insert("twoFactor", { ...base, userId: "u1" }),
      cleared: await ctx.db.insert("twoFactor", {
        ...base,
        userId: "u2",
        lockedUntil: null,
      }),
      expired: await ctx.db.insert("twoFactor", {
        ...base,
        userId: "u3",
        lockedUntil: Date.now() - 1000,
      }),
    }));
    const clearLock = (id: string) =>
      adapter.incrementOne<any>({
        model: "twoFactor",
        where: [
          { field: "id", value: id },
          { field: "lockedUntil", operator: "lte", value: new Date() },
        ],
        increment: {},
        set: { failedVerificationCount: 0, lockedUntil: null },
      });
    expect(await clearLock(ids.unset)).toBeNull();
    expect(await clearLock(ids.cleared)).toBeNull();
    expect(await clearLock(ids.expired)).toMatchObject({
      failedVerificationCount: 0,
      lockedUntil: null,
    });
  });
});
