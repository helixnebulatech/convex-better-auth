/// <reference types="vite/client" />

import { describe, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { getAuthTables } from "better-auth/db";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { username } from "better-auth/plugins/username";
import { internal } from "../component/_generated/api.js";
import pluginTableSchema from "../component/testProfiles/schema.profile-plugin-table.js";
import { checkUniqueFields, hasUniqueFields } from "./adapter-utils.js";
import { createSchema } from "./create-schema.js";

const modules = import.meta.glob("../component/**/*.*s");

describe("unique constraints", () => {
  it("enforces unique fields renamed with fieldName", async () => {
    const t = convexTest(pluginTableSchema, modules);
    // user.email is renamed to email_address in this profile
    const create = (internal as any).testProfiles.adapterRenameField.create;
    const data = {
      name: "a",
      email_address: "a@example.com",
      emailVerified: false,
      createdAt: 0,
      updatedAt: 0,
    };
    await t.mutation(create, { input: { model: "user", data } });
    await expect(
      t.mutation(create, { input: { model: "user", data } })
    ).rejects.toThrow("user email_address already exists");
  });

  // In SQL, NULL in a unique column never conflicts with another NULL
  it("allows any number of rows with a null unique field", async () => {
    const usernameTables = getAuthTables({ plugins: [username()] });
    const schema = defineSchema({
      user: defineTable({
        email: v.string(),
        username: v.optional(v.union(v.null(), v.string())),
      })
        .index("email", ["email"])
        .index("username", ["username"]),
    });
    const t = convexTest(schema, modules);
    const insert = (email: string, username: string | null | undefined) =>
      t.run(async (ctx) => {
        const data = { email, ...(username !== undefined ? { username } : {}) };
        await checkUniqueFields(ctx, schema, usernameTables, "user", data);
        return ctx.db.insert("user", data);
      });
    await insert("a@example.com", null);
    await insert("b@example.com", null);
    await insert("c@example.com", undefined);
    await insert("d@example.com", "dee");
    await expect(insert("e@example.com", "dee")).rejects.toThrow(
      "user username already exists"
    );
    // updateMany may set a null unique field on several rows
    expect(hasUniqueFields(usernameTables, "user", { username: null })).toBe(
      false
    );
    expect(hasUniqueFields(usernameTables, "user", { username: "x" })).toBe(
      true
    );
    // Setting a field to null on update doesn't conflict either
    const id = await insert("f@example.com", "eff");
    await t.run(async (ctx) => {
      const doc = await ctx.db.get("user", id);
      await checkUniqueFields(
        ctx,
        schema,
        usernameTables,
        "user",
        { username: null },
        doc!
      );
    });
  });

  // Better Auth 1.7 declares some unique constraints as table-level indexes
  // instead of field-level `unique`, e.g. the device authorization codes.
  const deviceTables = getAuthTables({ plugins: [deviceAuthorization()] });

  it("enforces table-level unique indexes", async () => {
    const schema = defineSchema({
      deviceCode: defineTable({
        deviceCode: v.string(),
        userCode: v.string(),
      })
        .index("deviceCode", ["deviceCode"])
        .index("userCode", ["userCode"]),
    });
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("deviceCode", { deviceCode: "d1", userCode: "u1" })
    );
    await expect(
      t.run((ctx) =>
        checkUniqueFields(ctx, schema, deviceTables, "deviceCode", {
          deviceCode: "d2",
          userCode: "u1",
        })
      )
    ).rejects.toThrow("deviceCode userCode already exists");
  });

  it("enforces table-level unique indexes missing from the schema", async () => {
    // Schemas generated before table-level indexes were supported
    const schema = defineSchema({
      deviceCode: defineTable({ deviceCode: v.string(), userCode: v.string() }),
    });
    const t = convexTest(schema, modules);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await t.run((ctx) =>
        ctx.db.insert("deviceCode", { deviceCode: "d1", userCode: "u1" })
      );
      const check = (input: Record<string, string>) =>
        t.run((ctx) =>
          checkUniqueFields(ctx, schema, deviceTables, "deviceCode", input)
        );
      await check({ deviceCode: "d2", userCode: "u2" });
      await expect(check({ deviceCode: "d1", userCode: "u2" })).rejects.toThrow(
        "deviceCode deviceCode already exists"
      );
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("enforces compound table-level unique indexes", async () => {
    const schema = defineSchema({
      member: defineTable({
        organizationId: v.string(),
        userId: v.string(),
      }).index("organizationId_userId", ["organizationId", "userId"]),
    });
    const tables = {
      member: {
        modelName: "member",
        fields: {
          organizationId: { type: "string", required: true },
          userId: { type: "string", required: true },
        },
        indexes: [{ fields: ["userId", "organizationId"], unique: true }],
      },
    } satisfies Parameters<typeof checkUniqueFields>[2];
    const t = convexTest(schema, modules);
    const existing = await t.run((ctx) =>
      ctx.db.insert("member", { organizationId: "o1", userId: "u1" })
    );
    const check = (input: Record<string, string>, doc?: any) =>
      t.run((ctx) =>
        checkUniqueFields(ctx, schema, tables, "member", input, doc)
      );
    // Partial overlaps are fine
    await check({ organizationId: "o1", userId: "u2" });
    await check({ organizationId: "o2", userId: "u1" });
    await expect(check({ organizationId: "o1", userId: "u1" })).rejects.toThrow(
      "member unique constraint userId+organizationId already exists"
    );
    // Updating one field of the constraint checks against the merged doc
    const other = await t.run(async (ctx) => {
      const id = await ctx.db.insert("member", {
        organizationId: "o2",
        userId: "u1",
      });
      return ctx.db.get("member", id);
    });
    await expect(check({ organizationId: "o1" }, other)).rejects.toThrow(
      "already exists"
    );
    // Rewriting a document's own values is not a conflict
    const self = await t.run((ctx) => ctx.db.get("member", existing));
    await check({ organizationId: "o1", userId: "u1" }, self);
  });

  it("generates schema indexes for table-level indexes", async () => {
    const { code } = await createSchema({ tables: deviceTables });
    expect(code).toContain('.index("deviceCode", ["deviceCode"])');
    expect(code).toContain('.index("userCode", ["userCode"])');
  });
});
