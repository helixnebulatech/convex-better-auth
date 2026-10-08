/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
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
    ).toMatchObject({ lockedUntil: lockedUntil.getTime() });
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
