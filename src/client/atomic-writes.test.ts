/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest";
import { anyApi } from "convex/server";
import { convexTest } from "convex-test";
import { twoFactor } from "better-auth/plugins/two-factor";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

// Better Auth 1.7 routes rate limiting, two factor lockouts and verification
// consumption through the atomic consumeOne/incrementOne adapter methods.
describe("atomic adapter writes", () => {
  const setup = () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const client = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    });
    return client.adapter(ctx)({
      rateLimit: { storage: "database" },
      plugins: [twoFactor()],
    });
  };

  it("increments a counter guarded by a range where", async () => {
    const adapter = setup();
    const now = Date.now();
    await adapter.create({
      model: "rateLimit",
      data: { key: "ip:/sign-in", count: 1, lastRequest: now },
    });
    const where = [
      { field: "key", value: "ip:/sign-in" },
      { field: "lastRequest", operator: "gt" as const, value: now - 10_000 },
      { field: "count", operator: "lt" as const, value: 2 },
    ];
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: { count: 1 },
        set: { lastRequest: now + 1 },
      })
    ).toMatchObject({ count: 2, lastRequest: now + 1 });
    // count is no longer below the limit, so the guard misses
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: { count: 1 },
      })
    ).toBeNull();
  });

  it("increments a counter that starts out unset", async () => {
    const adapter = setup();
    const row = await adapter.create<{ id: string }>({
      model: "twoFactor",
      data: { secret: "s", backupCodes: "[]", userId: "u1" },
    });
    expect(
      await adapter.incrementOne({
        model: "twoFactor",
        where: [{ field: "id", value: row.id }],
        increment: { failedVerificationCount: 1 },
      })
    ).toMatchObject({ failedVerificationCount: 1 });
    expect(
      await adapter.incrementOne({
        model: "twoFactor",
        where: [{ field: "id", value: row.id }],
        increment: { failedVerificationCount: 1 },
      })
    ).toMatchObject({ failedVerificationCount: 2 });
  });

  // Two factor lockout sets lockedUntil, which a fresh row never wrote. The
  // fallback guards on the row snapshot, so it matches lockedUntil eq null.
  it("sets a field that was never written", async () => {
    const adapter = setup();
    const row = await adapter.create<{ id: string }>({
      model: "twoFactor",
      data: { secret: "s", backupCodes: "[]", userId: "u1" },
    });
    const lockedUntil = new Date(Date.now() + 60_000);
    expect(
      await adapter.incrementOne({
        model: "twoFactor",
        where: [
          { field: "id", value: row.id },
          {
            field: "failedVerificationCount",
            operator: "gte" as const,
            value: 0,
          },
        ],
        increment: {},
        set: { lockedUntil },
      })
    ).toMatchObject({ lockedUntil });
  });

  it("consumes a row exactly once", async () => {
    const adapter = setup();
    await adapter.create({
      model: "verification",
      data: {
        identifier: "magic-link:abc",
        value: "{}",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const where = [{ field: "identifier", value: "magic-link:abc" }];
    expect(
      await adapter.consumeOne({ model: "verification", where })
    ).toMatchObject({ identifier: "magic-link:abc" });
    expect(
      await adapter.consumeOne({ model: "verification", where })
    ).toBeNull();
  });
});

// Without a native incrementOne, Better Auth reads the row and writes it
// with a compare-and-swap updateMany, and gives up after 5 attempts. Requests
// racing on the same rate limit row then failed with a contention error.
describe("native incrementOne", () => {
  const setup = (adapterApi: any = api.adapter) => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const calls: string[] = [];
    let interleave = false;
    const ctx = {
      runQuery: async (ref: any, args: any) => {
        const result = await t.query(ref, args);
        // Another request increments the row between this read and the write
        if (interleave && args.model === "rateLimit") {
          await t.run(async (ctx) => {
            const row = await ctx.db.query("rateLimit").first();
            await ctx.db.patch("rateLimit", row!._id, {
              count: row!.count + 1,
            });
          });
        }
        return result;
      },
      runMutation: async (ref: any, args: any) => {
        calls.push(args.input?.model ?? "");
        return t.mutation(ref, args);
      },
    } as any;
    const adapter = createClient<DataModel>({ adapter: adapterApi } as any, {
      verbose: false,
    }).adapter(ctx)({
      rateLimit: { storage: "database" },
      plugins: [twoFactor()],
    });
    return {
      t,
      adapter,
      calls,
      startInterleaving: () => {
        interleave = true;
      },
    };
  };
  const increment = (adapter: ReturnType<typeof setup>["adapter"]) =>
    adapter.incrementOne<{ count: number }>({
      model: "rateLimit",
      where: [{ field: "key", value: "ip:/sign-in" }],
      increment: { count: 1 },
    });

  it("increments in one mutation, with no read another request can race", async () => {
    const { t, adapter, calls, startInterleaving } = setup();
    await adapter.create({
      model: "rateLimit",
      data: { key: "ip:/sign-in", count: 0, lastRequest: Date.now() },
    });
    startInterleaving();
    calls.length = 0;
    expect(await increment(adapter)).toMatchObject({ count: 1 });
    expect(calls).toEqual(["rateLimit"]);
    const row = await t.run((ctx) => ctx.db.query("rateLimit").first());
    expect(row?.count).toBe(1);
  });

  it("applies SQL null semantics to its guards", async () => {
    const { t, adapter } = setup();
    // A row created before Better Auth added the counter
    const id = await t.run((ctx) =>
      ctx.db.insert("twoFactor", {
        secret: "s",
        backupCodes: "[]",
        userId: "u1",
      })
    );
    const row = { id };
    // A comparison with an unset counter is never true, as in SQL, so
    // Better Auth's unguarded increment is the one that starts it
    expect(
      await adapter.incrementOne({
        model: "twoFactor",
        where: [
          { field: "id", value: row.id },
          { field: "failedVerificationCount", operator: "lt", value: 5 },
        ],
        increment: { failedVerificationCount: 1 },
      })
    ).toBeNull();
  });

  it("rejects incrementing a field that isn't a number", async () => {
    const { adapter } = setup();
    await adapter.create({
      model: "rateLimit",
      data: { key: "ip:/sign-in", count: 0, lastRequest: Date.now() },
    });
    await expect(
      adapter.incrementOne({
        model: "rateLimit",
        where: [{ field: "key", value: "ip:/sign-in" }],
        increment: { key: 1 },
      })
    ).rejects.toThrow(/non-numeric/);
  });

  // A Local Install whose adapter.ts was written before incrementOne existed
  const oldLocalInstall = (incrementOne?: unknown) => ({
    create: api.adapter.create,
    findOne: api.adapter.findOne,
    findMany: api.adapter.findMany,
    updateOne: api.adapter.updateOne,
    updateMany: api.adapter.updateMany,
    deleteOne: api.adapter.deleteOne,
    deleteMany: api.adapter.deleteMany,
    ...(incrementOne ? { incrementOne } : {}),
  });

  it.each([
    ["isn't exported", (anyApi as any).adapter.incrementOneNotExported],
    ["isn't in the component api", undefined],
  ])(
    "falls back to a compare-and-swap update when incrementOne %s",
    async (_, incrementOne) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { t, adapter } = setup(oldLocalInstall(incrementOne));
      await adapter.create({
        model: "rateLimit",
        data: { key: "ip:/sign-in", count: 0, lastRequest: Date.now() },
      });
      expect(await increment(adapter)).toMatchObject({ count: 1 });
      expect(await increment(adapter)).toMatchObject({ count: 2 });
      const row = await t.run((ctx) => ctx.db.query("rateLimit").first());
      expect(row?.count).toBe(2);
      warn.mockRestore();
    }
  );

  it("retries the fallback when another request wins the race", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { t, adapter, startInterleaving } = setup(oldLocalInstall());
    await adapter.create({
      model: "rateLimit",
      data: { key: "ip:/sign-in", count: 0, lastRequest: Date.now() },
    });
    startInterleaving();
    // Every read is followed by another request's write, so every
    // compare-and-swap misses
    await expect(increment(adapter)).rejects.toThrow(/contention/);
    const row = await t.run((ctx) => ctx.db.query("rateLimit").first());
    expect(row?.count).toBe(5);
    vi.restoreAllMocks();
  });
});

// Better Auth's Kysely and memory adapters, and its atomic fallback, take the
// first row when the where is empty, and so does the component
describe("atomic writes with an empty where", () => {
  it("consume and increment the first row", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({ rateLimit: { storage: "database" } });
    for (const key of ["a", "b"]) {
      await adapter.create({
        model: "rateLimit",
        data: { key, count: 0, lastRequest: Date.now() },
      });
    }
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where: [],
        increment: { count: 1 },
      })
    ).toMatchObject({ key: "a", count: 1 });
    expect(
      await adapter.consumeOne({ model: "rateLimit", where: [] })
    ).toMatchObject({ key: "a" });
    expect(await adapter.count({ model: "rateLimit" })).toBe(1);
  });
});
