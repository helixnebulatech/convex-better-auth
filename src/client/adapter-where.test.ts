/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

// Component-level where semantics that the adapter factory tests can't reach
// directly, e.g. clauses on indexed fields Better Auth's test options don't know.
describe("component where clauses", () => {
  it("matches unset indexed fields against eq null", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    const user = {
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    };
    const [unset, explicitNull] = await t.run(async (ctx) => [
      await ctx.db.insert("user", { ...user, name: "a", email: "a@a.com" }),
      await ctx.db.insert("user", {
        ...user,
        name: "b",
        email: "b@b.com",
        userId: null,
      }),
      await ctx.db.insert("user", {
        ...user,
        name: "c",
        email: "c@c.com",
        userId: "c",
      }),
    ]);
    const { page } = await t.query(api.adapter.findMany, {
      model: "user",
      // userId has its own index
      where: [{ field: "userId", operator: "eq", value: null }],
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.map((doc: any) => doc._id).sort()).toEqual(
      [unset, explicitNull].sort()
    );
  });
});

// Better Auth's SQL adapters send an undefined value as a NULL parameter, and
// a comparison with NULL is never true: `where image = NULL` matches no row,
// unlike `IS NULL`. Convex can't send undefined at all, so these calls failed
// validation with "Missing required field value".
describe("where clauses comparing with undefined", () => {
  const setup = async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const image of [undefined, null, "u1"]) {
        await ctx.db.insert("user", {
          name: String(image),
          email: `${String(image)}@example.com`,
          emailVerified: false,
          createdAt: now,
          updatedAt: now,
          ...(image === undefined ? {} : { image }),
        });
      }
    });
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({});
    const count = () =>
      t.run(async (ctx) => (await ctx.db.query("user").collect()).length);
    return { adapter, count };
  };

  it.each(["eq", "ne", "lt", "gte", "not_in"] as const)(
    "%s undefined matches no row",
    async (operator) => {
      const { adapter, count } = await setup();
      const where = [{ field: "image", operator, value: undefined as any }];
      expect(await adapter.findOne({ model: "user", where })).toBeNull();
      expect(await adapter.findMany({ model: "user", where })).toEqual([]);
      expect(await adapter.count({ model: "user", where })).toBe(0);
      expect(
        await adapter.updateMany({
          model: "user",
          where,
          update: { name: "updated" },
        })
      ).toBe(0);
      expect(await adapter.deleteMany({ model: "user", where })).toBe(0);
      expect(await adapter.consumeOne({ model: "user", where })).toBeNull();
      await adapter.delete({ model: "user", where });
      expect(await count()).toBe(3);
    }
  );

  it("drops only the OR branch that compares with undefined", async () => {
    const { adapter } = await setup();
    const rows = await adapter.findMany<{ name: string }>({
      model: "user",
      where: [
        { field: "image", value: undefined as any, connector: "OR" },
        { field: "image", value: "u1", connector: "OR" },
      ],
    });
    expect(rows.map((row) => row.name)).toEqual(["u1"]);
  });
});
