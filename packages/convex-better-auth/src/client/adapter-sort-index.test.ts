/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { getAuthTables } from "better-auth/db";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { paginate } from "./adapter-utils.js";
import { createClient } from "./index.js";

// A sort the component does in memory reads every matching row in one query,
// which fails past Convex's read limit (32,000 documents): the admin plugin's
// listUsers then shows an empty list. A sort that follows an index reads one
// page at a time instead. These tests tell the two apart: a page from an
// index isn't the last one while rows remain, a sort in memory always is.
const setup = async () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const now = Date.now();
  // Created a, b, c, d, e; createdAt order b, d, a, e, c
  const users = [
    { name: "a", createdAt: now + 30, emailVerified: true, image: "x" },
    { name: "b", createdAt: now + 10, emailVerified: false, image: null },
    { name: "c", createdAt: now + 50, emailVerified: true, image: null },
    { name: "d", createdAt: now + 20, emailVerified: true, image: "x" },
    { name: "e", createdAt: now + 40, emailVerified: false, image: "x" },
  ];
  await t.run(async (ctx) => {
    for (const user of users) {
      await ctx.db.insert("user", {
        ...user,
        email: `${user.name}@example.com`,
        updatedAt: now,
      });
    }
  });
  const page = (args: { where?: any[]; sortBy: any; numItems: number }) =>
    t.run(async (ctx) => {
      const result = await paginate(ctx as any, schema, getAuthTables({}), {
        model: "user",
        ...args,
        paginationOpts: { numItems: args.numItems, cursor: null },
      } as any);
      return {
        names: result.page.map((doc: any) => doc.name),
        isDone: result.isDone,
      };
    });
  const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
    verbose: false,
  }).adapter({
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as any)({});
  const find = async (where: any[] | undefined, sortBy: any, limit?: number) =>
    (
      await adapter.findMany<{ name: string }>({
        model: "user",
        where,
        sortBy,
        limit,
      })
    ).map((row) => row.name);
  return { page, find };
};

const createdAtDesc = { field: "createdAt", direction: "desc" } as const;

describe("sortBy with an index on the sort field", () => {
  it("lists users by createdAt from the createdAt index, a page at a time", async () => {
    const { page, find } = await setup();
    expect(await page({ sortBy: createdAtDesc, numItems: 2 })).toEqual({
      names: ["c", "e"],
      isDone: false,
    });
    expect(await find(undefined, createdAtDesc, 3)).toEqual(["c", "e", "a"]);
  });

  it("filters by a field without an index while following the sort index", async () => {
    const { page, find } = await setup();
    const where = [{ field: "emailVerified", value: true }];
    expect(await page({ where, sortBy: createdAtDesc, numItems: 1 })).toEqual({
      names: ["c"],
      isDone: false,
    });
    expect(await find(where, createdAtDesc)).toEqual(["c", "a", "d"]);
    expect(await find(where, createdAtDesc, 2)).toEqual(["c", "a"]);
  });

  it("filters by null while following the sort index", async () => {
    const { find } = await setup();
    const where = [{ field: "image", value: null }];
    expect(await find(where, createdAtDesc)).toEqual(["c", "b"]);
  });

  it("filters with in while following the sort index", async () => {
    const { find } = await setup();
    const where = [{ field: "image", operator: "in", value: ["x"] }];
    expect(await find(where, { field: "createdAt", direction: "asc" })).toEqual(
      ["d", "a", "e"]
    );
  });

  it("does the same for another sort field with an index", async () => {
    const { page, find } = await setup();
    const where = [{ field: "emailVerified", value: false }];
    const nameAsc = { field: "name", direction: "asc" } as const;
    expect(await page({ where, sortBy: nameAsc, numItems: 1 })).toEqual({
      names: ["b"],
      isDone: false,
    });
    expect(await find(where, nameAsc)).toEqual(["b", "e"]);
  });
});

describe("sortBy when the filter has its own index", () => {
  // The filter's index reads only the matching rows, which are then sorted.
  // Scanning the sort field's index instead would read the whole table, a
  // page at a time, to find them.
  it("reads the matching rows through the filter's index", async () => {
    const { page, find } = await setup();
    const where = [{ field: "name", value: "d" }];
    expect(await page({ where, sortBy: createdAtDesc, numItems: 1 })).toEqual({
      names: ["d"],
      isDone: true,
    });
    expect(await find(where, createdAtDesc)).toEqual(["d"]);
  });
});

describe("sortBy ties follow creation order", () => {
  // Only an index on the sort field alone is scanned with a filter: a
  // compound one, such as providerId_userId, would order ties by its second
  // field instead of by creation, unlike every other path.
  it("doesn't scan a compound index starting with the sort field", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const userId of ["z", "y", "x"]) {
        await ctx.db.insert("account", {
          accountId: `acc-${userId}`,
          providerId: "google",
          userId,
          scope: "s",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter({
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any)({});
    const rows = await adapter.findMany<{ userId: string }>({
      model: "account",
      where: [{ field: "scope", value: "s" }],
      sortBy: { field: "providerId", direction: "asc" },
    });
    expect(rows.map((row) => row.userId)).toEqual(["z", "y", "x"]);
  });
});
