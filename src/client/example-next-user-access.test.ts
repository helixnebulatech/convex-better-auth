/// <reference types="vite/client" />

// The Next.js example used to expose a public getUserById query that returned
// any user's document to unauthenticated callers. Its modules import the built
// package ("@convex-dev/better-auth"), so run `pnpm run build` first, as CI
// does. They're loaded through import.meta.glob because the examples aren't
// part of this TypeScript project.
import { expect, it } from "vitest";
import { convexTest } from "convex-test";
import { anyApi, componentsGeneric } from "convex/server";

const exampleDir = "../../examples/next/convex";
const schemas = import.meta.glob(
  [
    "../../examples/next/convex/schema.ts",
    "../../examples/next/convex/betterAuth/schema.ts",
  ],
  { import: "default" }
);
const appModules = import.meta.glob([
  "../../examples/next/convex/*.*s",
  "../../examples/next/convex/_generated/*.*s",
]);
const authModules = import.meta.glob(
  "../../examples/next/convex/betterAuth/**/*.*s"
);

it(
  "examples/next has no public query returning a user by id",
  { timeout: 30_000 },
  async () => {
    const appSchema: any = await schemas[`${exampleDir}/schema.ts`]!();
    const authSchema: any = await schemas[`${exampleDir}/betterAuth/schema.ts`]!();
    const t = convexTest(appSchema, appModules);
    t.registerComponent("betterAuth", authSchema, authModules);
    const components = componentsGeneric() as any;
    const victim: any = await t.run(async (ctx: any) =>
      ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: "user",
          data: {
            name: "Victim",
            email: "victim@example.com",
            emailVerified: true,
            createdAt: 1,
            updatedAt: 1,
          },
        },
      })
    );
    // No identity: the caller is anonymous.
    await expect(
      t.query((anyApi as any).auth.getUserById, { userId: victim._id })
    ).rejects.toThrow(/getUserById/);
  }
);
