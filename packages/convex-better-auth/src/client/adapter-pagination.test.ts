/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api, internal } from "../component/_generated/api.js";
import defaultSchema from "../component/schema.js";
import schema from "../component/testProfiles/schema.profile-plugin-table.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

/**
 * Regression test for get-convex/better-auth#392: count() is an unlimited
 * paginated findMany and must terminate over result sets larger than the
 * 200-row page size. The runQuery cap turns a non-terminating loop into a
 * fast, clear failure instead of running to the function's wall-clock limit,
 * so the test never hangs CI when the bug regresses.
 */
describe("count() pagination", () => {
  it("terminates over more than 200 rows", async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    let paginatedQueries = 0;
    const ctx = {
      runMutation: t.mutation.bind(t),
      runQuery: async (...args: any[]) => {
        paginatedQueries += 1;
        if (paginatedQueries > 50) {
          throw new Error(
            `count() issued ${paginatedQueries} paginated queries without terminating (infinite pagination loop)`
          );
        }
        return (t.query as any)(...args);
      },
    } as any;

    // `.adapter(ctx)` returns a Better Auth adapter factory; resolve it with
    // options (the Convex adapter generates ids itself, so empty options are
    // enough to expose the core `user` model).
    const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
      verbose: false,
    }).adapter(ctx)({} as BetterAuthOptions);

    for (let i = 0; i < 201; i++) {
      await adapter.create({
        model: "user",
        data: { name: `foo${i}`, email: `foo${i}@bar.com` },
      });
    }
    paginatedQueries = 0; // count only the pagination queries
    expect(await adapter.count({ model: "user" })).toBe(201);
  });
});

// A filtered scan that rejects rows inside a page runs out of its row budget
// before the page fills, and Convex returns the page with a splitCursor. The
// page already holds every row up to continueCursor, so resuming from
// splitCursor read the second half of the page again.
describe("filtered scans past a split page", () => {
  const TOTAL = 400;
  const isRejected = (i: number) => i % 2 === 1 && i < 200;
  const setup = async () => {
    const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let i = 0; i < TOTAL; i++) {
        await ctx.db.insert("user", {
          name: `user-${i}`,
          email: isRejected(i)
            ? `other-${i}@example.test`
            : `match-${i}@example.test`,
          emailVerified: false,
          createdAt: now,
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
    }).adapter(ctx)({} as BetterAuthOptions);
    return { t, adapter };
  };
  const where = [
    { field: "email", operator: "starts_with" as const, value: "match-" },
  ];
  const matching = Array.from({ length: TOTAL }, (_, i) => i).filter(
    (i) => !isRejected(i)
  ).length;

  it("counts and finds every matching row once", async () => {
    const { adapter } = await setup();
    expect(await adapter.count({ model: "user", where })).toBe(matching);
    const rows = await adapter.findMany<{ id: string }>({
      model: "user",
      where,
      limit: 1000,
    });
    expect(rows).toHaveLength(matching);
    expect(new Set(rows.map((row) => row.id)).size).toBe(matching);
  });

  it("updates and deletes every matching row once", async () => {
    const { t, adapter } = await setup();
    expect(
      await adapter.updateMany({
        model: "user",
        where,
        update: { image: "updated" },
      })
    ).toBe(matching);
    expect(await adapter.deleteMany({ model: "user", where })).toBe(matching);
    const remaining = await t.run((ctx) => ctx.db.query("user").collect());
    expect(remaining).toHaveLength(TOTAL - matching);
  });
});

// Patching the field updateMany filters on moves a row in the index the scan
// reads, past the cursor, so the next page read it again and patched it twice.
describe("updateMany on the field it filters on", () => {
  it("updates and counts each row once", async () => {
    const t = convexTest(
      defaultSchema,
      import.meta.glob("../component/**/*.*s")
    );
    const now = Date.now();
    const TOTAL = 250;
    await t.run(async (ctx) => {
      for (let i = 0; i < TOTAL; i++) {
        await ctx.db.insert("session", {
          token: `t${String(i)}`,
          userId: "user",
          expiresAt: now + i,
          createdAt: now,
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
    }).adapter(ctx)({} as BetterAuthOptions);
    expect(
      await adapter.updateMany({
        model: "session",
        where: [
          { field: "expiresAt", operator: "gt", value: new Date(now - 1) },
        ],
        update: { expiresAt: new Date(now + 1_000_000) },
      })
    ).toBe(TOTAL);
    const docs = await t.run((ctx) => ctx.db.query("session").collect());
    expect(docs.every((doc) => doc.expiresAt === now + 1_000_000)).toBe(true);
  });

  it("fires onUpdate once per row", async () => {
    const t = convexTest(
      defaultSchema,
      import.meta.glob("../component/**/*.*s")
    );
    const now = Date.now();
    const TOTAL = 250;
    await t.run(async (ctx) => {
      for (let i = 0; i < TOTAL; i++) {
        await ctx.db.insert("session", {
          token: `t${String(i)}`,
          userId: "user",
          expiresAt: now + i,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await t.run(async (ctx) => {
      const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
        verbose: false,
        authFunctions: {
          onUpdate: internal.testTriggerHandlers.sessionOnUpdateMarker,
        } as any,
        triggers: {
          session: {
            onUpdate: async () => {},
          },
        },
      }).adapter(ctx as any)({} as BetterAuthOptions);
      await adapter.updateMany({
        model: "session",
        where: [
          { field: "expiresAt", operator: "gt", value: new Date(now - 1) },
        ],
        update: { expiresAt: new Date(now + 1_000_000) },
      });
    });
    const docs = await t.run((ctx) => ctx.db.query("session").collect());
    expect(docs.map((doc) => doc.userAgent)).toEqual(
      Array.from({ length: TOTAL }, () => "x")
    );
  });
});
