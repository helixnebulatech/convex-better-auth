/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { getAuthTables } from "better-auth/db";
import { paginate } from "./adapter-utils.js";

// Better Auth's adapters always honour sortBy: the SQL ones with ORDER BY,
// with or without an index. Convex can only order by an index, so without one
// that ends in the sort field the component sorts in memory.
describe("sortBy without an index", () => {
  const setup = async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const client = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    });
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "sort-test-secret-at-least-32-characters-long",
      database: client.adapter(ctx),
      logger: { disabled: true },
    });
    const { adapter } = await auth.$context;
    // Inserted out of order, with two verified users and one without image
    for (const [name, image, emailVerified] of [
      ["c", "img-c", true],
      ["a", "img-a", false],
      ["d", null, false],
      ["b", "img-b", true],
    ] as const) {
      await adapter.create({
        model: "user",
        data: {
          name,
          email: `${name}@example.com`,
          emailVerified,
          image,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    return adapter;
  };
  const names = (rows: { name: string }[]) => rows.map((row) => row.name);

  it("sorts and limits by a field with no index", async () => {
    const adapter = await setup();
    const find = (direction: "asc" | "desc", limit?: number) =>
      adapter.findMany<{ name: string }>({
        model: "user",
        sortBy: { field: "image", direction },
        limit,
      });
    expect(names(await find("desc", 2))).toEqual(["c", "b"]);
    expect(names(await find("asc"))).toEqual(["d", "a", "b", "c"]);
  });

  it("still sorts by an index when there is one", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ name: string }>({
      model: "user",
      sortBy: { field: "name", direction: "desc" },
      limit: 2,
    });
    expect(names(rows)).toEqual(["d", "c"]);
  });

  it("sorts null first ascending, like a Convex index", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ name: string }>({
      model: "user",
      sortBy: { field: "image", direction: "asc" },
      limit: 2,
    });
    expect(names(rows)).toEqual(["d", "a"]);
  });

  it("sorts with a where clause", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ name: string }>({
      model: "user",
      where: [{ field: "emailVerified", value: true }],
      sortBy: { field: "image", direction: "asc" },
      limit: 1,
    });
    expect(names(rows)).toEqual(["b"]);
  });

  it("sorts an OR query", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ name: string }>({
      model: "user",
      where: [
        { field: "email", value: "d@example.com", connector: "OR" },
        { field: "emailVerified", value: true, connector: "OR" },
      ],
      sortBy: { field: "image", direction: "desc" },
      limit: 2,
    });
    expect(names(rows)).toEqual(["c", "b"]);
  });
});

// generateQuery leaves eq null clauses out of its index choice, since an index
// range can't match unset fields. The in-memory sort decision has to choose
// the same way, or it trusts an index the query won't use.
describe("sortBy with an eq null clause", () => {
  it("sorts when only an index starting with the null field ends in the sort field", async () => {
    const schema = defineSchema({
      user: defineTable({
        name: v.string(),
        username: v.optional(v.union(v.null(), v.string())),
      }).index("username_name", ["username", "name"]),
    });
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const names = await t.run(async (ctx) => {
      for (const name of ["c", "a", "b"]) {
        await ctx.db.insert("user", { name, username: null });
      }
      const result = await paginate(ctx as any, schema, getAuthTables({}), {
        model: "user",
        where: [{ field: "username", operator: "eq", value: null }],
        sortBy: { field: "name", direction: "asc" },
        limit: 2,
        paginationOpts: { numItems: 2, cursor: null },
      } as any);
      return result.page.map((doc: any) => doc.name);
    });
    expect(names).toEqual(["a", "b"]);
  });
});

// An index scan with a range on one field returns rows in that field's order,
// so it can't serve a sort on another field, even when the index has the sort
// field next (session.expiresAt_userId).
describe("sortBy with a range on another field", () => {
  const setup = async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    // Created a, b, c, d; userId order c, a, d, b; expiresAt order d, c, b, a
    const rows = [
      { userId: "u2", expiresAt: now + 4000 },
      { userId: "u4", expiresAt: now + 3000 },
      { userId: "u1", expiresAt: now + 2000 },
      { userId: "u3", expiresAt: now + 1000 },
    ];
    await t.run(async (ctx) => {
      for (const [i, row] of rows.entries()) {
        await ctx.db.insert("session", {
          ...row,
          token: `token-${i}`,
          createdAt: now + i,
          updatedAt: now,
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
    return { adapter, now };
  };
  const userIds = (rows: { userId: string }[]) => rows.map((row) => row.userId);

  it("sorts by the other field", async () => {
    const { adapter, now } = await setup();
    const find = (direction: "asc" | "desc", limit?: number) =>
      adapter.findMany<{ userId: string }>({
        model: "session",
        where: [
          { field: "expiresAt", operator: "gt", value: new Date(now + 500) },
        ],
        sortBy: { field: "userId", direction },
        limit,
      });
    expect(userIds(await find("asc"))).toEqual(["u1", "u2", "u3", "u4"]);
    expect(userIds(await find("desc", 2))).toEqual(["u4", "u3"]);
  });

  it("sorts by createdAt", async () => {
    const { adapter, now } = await setup();
    const find = (direction: "asc" | "desc", limit?: number) =>
      adapter.findMany<{ userId: string }>({
        model: "session",
        where: [
          { field: "expiresAt", operator: "gt", value: new Date(now + 500) },
        ],
        sortBy: { field: "createdAt", direction },
        limit,
      });
    expect(userIds(await find("asc"))).toEqual(["u2", "u4", "u1", "u3"]);
    expect(userIds(await find("desc", 2))).toEqual(["u3", "u1"]);
  });

  it("sorts an in lookup with a range on another field", async () => {
    const { adapter, now } = await setup();
    const rows = await adapter.findMany<{ userId: string }>({
      model: "session",
      where: [
        { field: "userId", operator: "in", value: ["u1", "u2", "u3", "u4"] },
        { field: "expiresAt", operator: "gt", value: new Date(now + 500) },
      ],
      sortBy: { field: "createdAt", direction: "desc" },
    });
    expect(userIds(rows)).toEqual(["u3", "u1", "u4", "u2"]);
  });

  it("still uses the index for a range on the sort field", async () => {
    const { adapter, now } = await setup();
    const rows = await adapter.findMany<{ userId: string }>({
      model: "session",
      where: [
        { field: "expiresAt", operator: "gt", value: new Date(now + 1500) },
      ],
      sortBy: { field: "expiresAt", direction: "asc" },
    });
    expect(userIds(rows)).toEqual(["u1", "u4", "u2"]);
  });
});

// Ids and unique fields in an `in` are looked up one by one and sorted here,
// in the order every other path sorts: a Convex index's, nulls first.
describe("sortBy on an id in lookup", () => {
  it("sorts nulls and unset values first ascending, last descending", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    const ids = await t.run(async (ctx) => {
      const ids: string[] = [];
      for (const [name, image] of [
        ["b", "img-b"],
        ["unset", undefined],
        ["a", "img-a"],
        ["null", null],
        ["c", "img-c"],
        ["a2", "img-a"],
      ] as const) {
        ids.push(
          await ctx.db.insert("user", {
            name,
            email: `${name}@example.com`,
            emailVerified: false,
            ...(image === undefined ? {} : { image }),
            createdAt: now,
            updatedAt: now,
          })
        );
      }
      return ids;
    });
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({});
    const find = (field: string, direction: "asc" | "desc") =>
      adapter.findMany<{ name: string }>({
        model: "user",
        where: [{ field: "id", operator: "in", value: ids }],
        sortBy: { field, direction },
      });
    expect(names(await find("image", "asc"))).toEqual([
      "unset",
      "null",
      "a",
      "a2",
      "b",
      "c",
    ]);
    expect(names(await find("image", "desc"))).toEqual([
      "c",
      "b",
      "a2",
      "a",
      "null",
      "unset",
    ]);
  });
});
const names = (rows: { name: string }[]) => rows.map((row) => row.name);
