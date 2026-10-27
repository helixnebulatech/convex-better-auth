/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

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
    secret: "in-range-test-secret-at-least-32-characters",
    database: client.adapter(ctx),
    logger: { disabled: true },
  });
  const { adapter } = await auth.$context;
  const user = await adapter.create<{ id: string }>({
    model: "user",
    data: {
      name: "u",
      email: "u@example.com",
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  const day = 24 * 60 * 60 * 1000;
  for (const [token, createdAt] of [
    ["old", new Date(Date.now() - 2 * day)],
    ["new", new Date()],
  ] as const) {
    await adapter.create({
      model: "session",
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + day),
        createdAt,
        updatedAt: createdAt,
      },
    });
  }
  return { adapter, user, day };
};

describe("in and createdAt clauses, as in SQL", () => {
  it("matches each row once when an in value is repeated", async () => {
    const { adapter, user } = await setup();
    const where = (field: string, value: string[]) => [
      { field, operator: "in" as const, value },
    ];
    expect(
      await adapter.findMany({
        model: "session",
        where: where("token", ["old", "old", "new"]),
      })
    ).toHaveLength(2);
    expect(
      await adapter.findMany({
        model: "user",
        where: where("id", [user.id, user.id]),
      })
    ).toHaveLength(1);
    expect(
      await adapter.count({
        model: "session",
        where: where("token", ["new", "new"]),
      })
    ).toBe(1);
  });

  // session.userId's index is userId_expiresAt, so each value's rows come
  // ordered by expiresAt, not by creation time
  it("matches in on a non-unique field whose index has more fields", async () => {
    const { adapter, user } = await setup();
    const where = [
      { field: "userId", operator: "in" as const, value: [user.id, "other"] },
    ];
    expect(await adapter.count({ model: "session", where })).toBe(2);
    const rows = await adapter.findMany<{ token: string }>({
      model: "session",
      where,
    });
    expect(rows.map((row) => row.token).sort()).toEqual(["new", "old"]);
  });

  it("bounds createdAt next to an indexed equality", async () => {
    const { adapter, user, day } = await setup();
    const rows = await adapter.findMany<{ token: string }>({
      model: "session",
      where: [
        { field: "userId", value: user.id },
        {
          field: "createdAt",
          operator: "lt",
          value: new Date(Date.now() - day),
        },
      ],
    });
    // createdAt as stored, not the insertion time
    expect(rows.map((row) => row.token)).toEqual(["old"]);
  });
});
