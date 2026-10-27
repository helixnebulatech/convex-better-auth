/// <reference types="vite/client" />

import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { betterAuth } from "better-auth/minimal";
import { internal } from "../component/_generated/api.js";
import pluginTableSchema from "../component/testProfiles/schema.profile-plugin-table.js";
import { renameFieldProfileOptions } from "../component/testProfiles/auth-options.profile-rename-joins.js";
import { createClient } from "./index.js";

// Better Auth passes sortBy and select with its own field names. Each adapter
// maps them to the stored names, as Drizzle does with getFieldName.
describe("field names in sortBy and select", () => {
  const setup = async () => {
    const t = convexTest(
      pluginTableSchema,
      import.meta.glob("../component/**/*.*s")
    );
    const ctx = {
      runQuery: t.query.bind(t),
      runMutation: t.mutation.bind(t),
    } as any;
    // user.email is stored as email_address in this profile
    const client = createClient(
      { adapter: (internal as any).testProfiles.adapterRenameField } as any,
      { verbose: false }
    );
    const auth = betterAuth({
      ...renameFieldProfileOptions,
      baseURL: "http://localhost:3000",
      secret: "field-names-test-secret-at-least-32-characters",
      database: client.adapter(ctx),
      logger: { disabled: true },
    });
    const { adapter } = await auth.$context;
    // Names in another order than emails, so sorting by the wrong field shows
    for (const [name, email] of [
      ["n1", "c@example.com"],
      ["n2", "a@example.com"],
      ["n3", "b@example.com"],
    ]) {
      await adapter.create({
        model: "user",
        data: {
          name,
          email,
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    return adapter;
  };

  it("sorts by a renamed field", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ email: string }>({
      model: "user",
      sortBy: { field: "email", direction: "asc" },
    });
    expect(rows.map((row) => row.email)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });

  it("selects a renamed field", async () => {
    const adapter = await setup();
    const rows = await adapter.findMany<{ email: string }>({
      model: "user",
      select: ["email"],
      sortBy: { field: "email", direction: "desc" },
      limit: 1,
    });
    expect(rows).toEqual([{ email: "c@example.com" }]);
    const one = await adapter.findOne<{ email: string; name: string }>({
      model: "user",
      where: [{ field: "email", value: "a@example.com" }],
      select: ["email", "name"],
    });
    expect(one).toEqual({ email: "a@example.com", name: "n2" });
  });
});
