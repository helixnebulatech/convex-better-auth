/// <reference types="vite/client" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import type { BetterAuthOptions } from "better-auth";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import { createClient } from "./index.js";
import type { DataModel } from "../component/_generated/dataModel.js";

// Queries Better Auth 1.7 issues against the shipped component schema must
// use an index, otherwise the adapter scans the whole table.
const setup = () => {
  const t = convexTest(schema, import.meta.glob("../component/**/*.*s"));
  const ctx = {
    runMutation: t.mutation.bind(t),
    runQuery: t.query.bind(t),
  } as any;
  const adapter = createClient<DataModel>({ adapter: api.adapter } as any, {
    verbose: false,
  }).adapter(ctx)({ rateLimit: { storage: "database" } } as BetterAuthOptions);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const unindexedWarnings = () =>
    warn.mock.calls.filter(([message]) =>
      String(message).includes("Querying without an index")
    );
  return { t, adapter, unindexedWarnings };
};

describe("indexed queries issued by Better Auth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // multi-session: internalAdapter.findSessions(tokens, { onlyActiveSessions })
  it("finds active sessions by token list with an index", async () => {
    const { t, adapter, unindexedWarnings } = setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const [token, userId, expiresAt] of [
        ["active", "u1", now + 60_000],
        ["expired", "u1", now - 60_000],
        ["other", "u2", now + 60_000],
      ] as const) {
        await ctx.db.insert("session", {
          token,
          userId,
          expiresAt,
          createdAt: 0,
          updatedAt: 0,
        });
      }
    });

    const sessions = await adapter.findMany<{ token: string }>({
      model: "session",
      where: [
        { field: "token", value: ["active", "expired"], operator: "in" },
        { field: "expiresAt", value: new Date(now), operator: "gt" },
      ],
    });

    expect(sessions.map((s) => s.token)).toEqual(["active"]);
    expect(unindexedWarnings()).toEqual([]);

    const limited = await adapter.findMany<{ token: string }>({
      model: "session",
      where: [{ field: "token", value: ["active", "other"], operator: "in" }],
      sortBy: { field: "token", direction: "desc" },
      limit: 1,
    });
    expect(limited.map((s) => s.token)).toEqual(["other"]);
  });
});
