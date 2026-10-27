/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

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
