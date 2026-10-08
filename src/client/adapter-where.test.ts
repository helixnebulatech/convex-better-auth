/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";

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
