/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

// Single row lookups (findOne, update, delete) without an index read the table
// in pages of 200 rows. They must keep reading until they find the row or reach
// the end of the table, instead of reporting a row past the first page as
// missing.
const setup = async () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runMutation: t.mutation.bind(t),
    runQuery: t.query.bind(t),
  } as any;
  const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
    verbose: false,
  }).adapter(ctx)({} as BetterAuthOptions);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await t.run(async (ctx) => {
    for (let i = 0; i < 450; i++) {
      await ctx.db.insert("user", {
        name: `user ${i}`,
        email: `user${i}@example.com`,
        emailVerified: false,
        image: `other-${i}`,
        createdAt: 0,
        updatedAt: 0,
      });
    }
    await ctx.db.insert("user", {
      name: "target",
      email: "target@example.com",
      emailVerified: false,
      image: "target",
      createdAt: 0,
      updatedAt: 0,
    });
  });
  return { t, adapter };
};

const where = [{ field: "image", value: "target" }];

describe("single row lookups without an index", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("findOne finds a row past the first page", async () => {
    const { adapter } = await setup();
    const user = await adapter.findOne<{ name: string }>({
      model: "user",
      where,
    });
    expect(user?.name).toBe("target");
  });

  it("findOne returns null when no row matches", async () => {
    const { adapter } = await setup();
    const user = await adapter.findOne({
      model: "user",
      where: [{ field: "image", value: "missing" }],
    });
    expect(user).toBeNull();
  });

  it("update updates a row past the first page", async () => {
    const { t, adapter } = await setup();
    const user = await adapter.update<{ name: string }>({
      model: "user",
      where,
      update: { name: "updated" },
    });
    expect(user?.name).toBe("updated");
    const stored = await t.run((ctx) =>
      ctx.db
        .query("user")
        .withIndex("email_name", (q) => q.eq("email", "target@example.com"))
        .unique()
    );
    expect(stored?.name).toBe("updated");
  });

  it("delete deletes a row past the first page", async () => {
    const { t, adapter } = await setup();
    await adapter.delete({ model: "user", where });
    const stored = await t.run((ctx) =>
      ctx.db
        .query("user")
        .withIndex("email_name", (q) => q.eq("email", "target@example.com"))
        .unique()
    );
    expect(stored).toBeNull();
  });
});
