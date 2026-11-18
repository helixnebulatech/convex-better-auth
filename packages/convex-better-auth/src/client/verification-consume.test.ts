/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import type { Where } from "better-auth/types";
import { api } from "../component/_generated/api.js";
import schema from "../component/schema.js";
import type { DataModel } from "../component/_generated/dataModel.js";
import { createClient } from "./index.js";

// Since Better Auth 1.7.22, consumeVerificationValue (password reset, email
// OTP, magic link, phone and two factor OTP) finds the identifier's latest
// row, deletes the older ones with `identifier eq`, `id ne latest` and
// `createdAt lte latest`, then consumes the latest. Upstream's adapter
// rejected that where clause (get-convex/better-auth#481). Rows are created
// out of createdAt order, so the bound must follow the stored createdAt, not
// _creationTime.
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
    secret: "verification-consume-secret-at-least-32-chars",
    database: client.adapter(ctx),
    logger: { disabled: true },
  });
  const context = await auth.$context;
  const at = Date.now() - 60_000;
  const create = async (identifier: string, value: string, offset: number) =>
    (
      await context.adapter.create<{ id: string }>({
        model: "verification",
        data: {
          identifier,
          value,
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(at + offset),
          updatedAt: new Date(at + offset),
        },
      })
    ).id;
  const latest = await create("otp:a", "latest", 2);
  const older = await create("otp:a", "older", 1);
  const newer = await create("otp:a", "newer", 3);
  const olderStill = await create("otp:a", "older-still", 0);
  const other = await create("otp:b", "other", 0);
  // At the bound itself: lte includes it
  const tied = await create("otp:a", "tied", 2);
  const where: Where[] = [
    { field: "identifier", value: "otp:a" },
    { field: "id", operator: "ne", value: latest },
    { field: "createdAt", operator: "lte", value: new Date(at + 2) },
  ];
  const remaining = async () =>
    (
      await context.adapter.findMany<{ value: string }>({
        model: "verification",
      })
    )
      .map((row) => row.value)
      .sort();
  return {
    context,
    ids: { latest, older, newer, olderStill, other, tied },
    where,
    remaining,
  };
};

describe("verification consume, as in Better Auth 1.7.22+", () => {
  it("findMany returns only the older rows of the identifier", async () => {
    const { context, ids, where } = await setup();
    const found = await context.adapter.findMany<{ id: string }>({
      model: "verification",
      where,
    });
    expect(found.map((row) => row.id).sort()).toEqual(
      [ids.older, ids.olderStill, ids.tied].sort()
    );
  });

  it("deleteMany removes the older rows and keeps the rest", async () => {
    const { context, where, remaining } = await setup();
    expect(
      await context.adapter.deleteMany({ model: "verification", where })
    ).toBe(3);
    expect(await remaining()).toEqual(["latest", "newer", "other"]);
  });

  // Rows created in createdAt order, as Better Auth creates them
  it("consumeVerificationValue consumes the latest row and drops the older ones", async () => {
    const { context, remaining } = await setup();
    // Rows of other identifiers that match the other delete conditions
    const others = await remaining();
    for (const value of ["first", "second", "third"]) {
      await context.internalAdapter.createVerificationValue({
        identifier: "otp:c",
        value,
        expiresAt: new Date(Date.now() + 60_000),
      });
    }
    const consumed =
      await context.internalAdapter.consumeVerificationValue("otp:c");
    expect(consumed?.value).toBe("third");
    expect(await remaining()).toEqual(others);
    expect(
      await context.internalAdapter.consumeVerificationValue("otp:c")
    ).toBeNull();
  });

  // Two near-simultaneous requests can commit out of createdAt order. Better
  // Auth consumes the row with the latest createdAt and deletes the older
  // one, so no row of the identifier stays valid.
  it("consumes the latest createdAt when rows commit out of order", async () => {
    const { context } = await setup();
    const at = Date.now();
    for (const [value, offset] of [
      ["newer", 2],
      ["older", 1],
    ] as const) {
      await context.adapter.create({
        model: "verification",
        data: {
          identifier: "otp:race",
          value,
          expiresAt: new Date(at + 60_000),
          createdAt: new Date(at + offset),
          updatedAt: new Date(at + offset),
        },
      });
    }
    const consumed =
      await context.internalAdapter.consumeVerificationValue("otp:race");
    expect(consumed?.value).toBe("newer");
    expect(
      await context.internalAdapter.consumeVerificationValue("otp:race")
    ).toBeNull();
  });
});
