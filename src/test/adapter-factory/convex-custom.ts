import { createTestSuite } from "@better-auth/test-utils/adapter";
import { expect } from "vitest";

export const convexCustomTestSuite = createTestSuite(
  "convex-custom",
  {},
  ({ adapter }) => ({
    "should handle lone range operators": async () => {
      const user = await adapter.create({
        model: "user",
        data: {
          name: "ab",
          email: "a@a.com",
        },
      });
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            {
              field: "name",
              operator: "lt",
              value: "a",
            },
          ],
        }),
      ).toEqual([]);
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            {
              field: "name",
              operator: "lte",
              value: "a",
            },
          ],
        }),
      ).toEqual([]);
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            {
              field: "name",
              operator: "gt",
              value: "a",
            },
          ],
        }),
      ).toEqual([user]);
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            {
              field: "name",
              operator: "gte",
              value: "ab",
            },
          ],
        }),
      ).toEqual([user]);
    },

    "should handle compound indexes that include id field": async () => {
      const user = await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "wrong name",
            },
          ],
        }),
      ).toEqual(null);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "foo",
            },
          ],
        }),
      ).toEqual(user);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "foo",
              operator: "lt",
            },
          ],
        }),
      ).toEqual(null);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "foo",
              operator: "lte",
            },
          ],
        }),
      ).toEqual(user);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "foo",
              operator: "gt",
            },
          ],
        }),
      ).toEqual(null);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              value: "foo",
              operator: "gte",
            },
          ],
        }),
      ).toEqual(user);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              operator: "in",
              value: ["wrong", "name"],
            },
          ],
        }),
      ).toEqual(null);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            {
              field: "id",
              value: user.id,
            },
            {
              field: "name",
              operator: "in",
              value: ["foo"],
            },
          ],
        }),
      ).toEqual(user);
    },

    "should use composite index for eq + sortBy on second field": async () => {
      const sharedExpiresAt = Date.now() + 60_000;
      await adapter.create({
        model: "session",
        data: {
          token: `tok-z-${sharedExpiresAt}`,
          expiresAt: sharedExpiresAt,
          userId: "zzz-user",
          createdAt: sharedExpiresAt,
          updatedAt: sharedExpiresAt,
        },
      });
      await adapter.create({
        model: "session",
        data: {
          token: `tok-a-${sharedExpiresAt}`,
          expiresAt: sharedExpiresAt,
          userId: "aaa-user",
          createdAt: sharedExpiresAt,
          updatedAt: sharedExpiresAt,
        },
      });
      await adapter.create({
        model: "session",
        data: {
          token: `tok-m-${sharedExpiresAt}`,
          expiresAt: sharedExpiresAt,
          userId: "mmm-user",
          createdAt: sharedExpiresAt,
          updatedAt: sharedExpiresAt,
        },
      });
      await adapter.create({
        model: "session",
        data: {
          token: `tok-non-matching-${sharedExpiresAt}`,
          expiresAt: sharedExpiresAt + 60_000,
          userId: "bbb-user",
          createdAt: sharedExpiresAt,
          updatedAt: sharedExpiresAt,
        },
      });

      const result = await adapter.findMany<{ userId: string }>({
        model: "session",
        where: [{ field: "expiresAt", value: sharedExpiresAt }],
        sortBy: { field: "userId", direction: "asc" },
        select: ["userId"],
      });

      expect(result.map((session) => session.userId)).toEqual([
        "aaa-user",
        "mmm-user",
        "zzz-user",
      ]);
    },

    "should automatically paginate": async () => {
      for (let i = 0; i < 300; i++) {
        await adapter.create({
          model: "user",
          data: {
            name: `foo${i}`,
            email: `foo${i}@bar.com`,
          },
        });
      }
      // Better Auth defaults to a limit of 100
      expect(
        await adapter.findMany({
          model: "user",
        }),
      ).toHaveLength(100);

      // Pagination has a hardcoded numItems max of 200, this tests that it can handle
      // specified limits beyond that
      expect(
        await adapter.findMany({
          model: "user",
          limit: 250,
        }),
      ).toHaveLength(250);
      expect(
        await adapter.findMany({
          model: "user",
          limit: 350,
        }),
      ).toHaveLength(300);
    },

    "should support select in findMany": async () => {
      await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      const result = await adapter.findMany({
        model: "user",
        where: [{ field: "email", value: "foo@bar.com" }],
        select: ["email"],
      });
      expect(result).toHaveLength(1);
      expect((result[0] as any).email).toEqual("foo@bar.com");
    },

    "should handle OR where clauses": async () => {
      const user = await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            { field: "name", value: "bar", connector: "OR" },
            { field: "name", value: "foo", connector: "OR" },
          ],
        }),
      ).toEqual(user);
    },

    "should handle OR where clauses with sortBy": async () => {
      const fooUser = await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      const barUser = await adapter.create({
        model: "user",
        data: {
          name: "bar",
          email: "bar@bar.com",
        },
      });
      await adapter.create({
        model: "user",
        data: {
          name: "baz",
          email: "baz@bar.com",
        },
      });
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            { field: "name", value: "bar", connector: "OR" },
            { field: "name", value: "foo", connector: "OR" },
          ],
          sortBy: { field: "name", direction: "asc" },
        }),
      ).toEqual([barUser, fooUser]);
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            { field: "name", value: "bar", connector: "OR" },
            { field: "name", value: "foo", connector: "OR" },
          ],
          sortBy: { field: "name", direction: "desc" },
        }),
      ).toEqual([fooUser, barUser]);
    },

    "should apply OR dedupe/sort/limit before select": async () => {
      const suffix = Date.now();
      const alphaOnly = await adapter.create({
        model: "user",
        data: {
          name: "alpha-only",
          email: `alpha-only-${suffix}@other.test`,
        },
      });
      const alphaOverlap = await adapter.create({
        model: "user",
        data: {
          name: "alpha-overlap",
          email: `alpha-overlap-${suffix}@example.com`,
        },
      });
      await adapter.create({
        model: "user",
        data: {
          name: "beta-only",
          email: `beta-only-${suffix}@example.com`,
        },
      });
      await adapter.create({
        model: "user",
        data: {
          name: "delta-only",
          email: `delta-only-${suffix}@example.com`,
        },
      });

      const result = await adapter.findMany<{ email: string }>({
        model: "user",
        where: [
          {
            field: "name",
            operator: "starts_with",
            value: "alpha",
            connector: "OR",
          },
          {
            field: "email",
            operator: "contains",
            value: "@example.com",
            connector: "OR",
          },
        ],
        sortBy: { field: "name", direction: "asc" },
        limit: 2,
        select: ["email"],
      });

      expect(result).toEqual([
        { email: alphaOnly.email },
        { email: alphaOverlap.email },
      ]);
    },

    "should return null and not modify records when update where is empty":
      async () => {
        const user = await adapter.create({
          model: "user",
          data: {
            name: "foo",
            email: "foo@bar.com",
          },
        });
        expect(
          await adapter.update({
            model: "user",
            where: [],
            update: { name: "bar" },
          }),
        ).toBeNull();
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: user.id }],
          }),
        ).toEqual(user);
      },

    "should update and count each match only once for overlapping OR clauses":
      async () => {
        const foo = await adapter.create({
          model: "user",
          data: {
            name: "foo",
            email: "foo@bar.com",
          },
        });
        const foobar = await adapter.create({
          model: "user",
          data: {
            name: "foobar",
            email: "foobar@bar.com",
          },
        });
        const count = await adapter.updateMany({
          model: "user",
          where: [
            { field: "name", value: "foo", connector: "OR" },
            {
              field: "name",
              operator: "starts_with",
              value: "foo",
              connector: "OR",
            },
          ],
          update: { emailVerified: true },
        });
        expect(count).toEqual(2);
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: foo.id }],
          }),
        ).toMatchObject({ emailVerified: true });
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: foobar.id }],
          }),
        ).toMatchObject({ emailVerified: true });
      },

    "should delete and count each match only once for overlapping OR clauses":
      async () => {
        await adapter.create({
          model: "user",
          data: {
            name: "foo",
            email: "foo@bar.com",
          },
        });
        await adapter.create({
          model: "user",
          data: {
            name: "foobar",
            email: "foobar@bar.com",
          },
        });
        const untouched = await adapter.create({
          model: "user",
          data: {
            name: "bar",
            email: "bar@bar.com",
          },
        });
        const count = await adapter.deleteMany({
          model: "user",
          where: [
            { field: "name", value: "foo", connector: "OR" },
            {
              field: "name",
              operator: "starts_with",
              value: "foo",
              connector: "OR",
            },
          ],
        });
        expect(count).toEqual(2);
        const result = await adapter.findMany({
          model: "user",
        });
        expect(result).toHaveLength(1);
        expect(result).toEqual([untouched]);
      },

    "should handle count": async () => {
      await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      await adapter.create({
        model: "user",
        data: {
          name: "bar",
          email: "bar@bar.com",
        },
      });
      expect(
        await adapter.count({
          model: "user",
          where: [{ field: "name", value: "foo" }],
        }),
      ).toEqual(1);
    },

    "should handle queries with no index": async () => {
      const user = await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
          emailVerified: true,
        },
      });
      expect(
        await adapter.findOne({
          model: "user",
          where: [{ field: "emailVerified", value: true }],
        }),
      ).toEqual(user);
      expect(
        await adapter.findOne({
          model: "user",
          where: [{ field: "emailVerified", value: false }],
        }),
      ).toEqual(null);
    },

    "should handle compound operator on non-unique field without an index":
      async () => {
        await adapter.create({
          model: "account",
          data: {
            accountId: "foo",
            providerId: "bar",
            userId: "baz",
            accessTokenExpiresAt: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
        expect(
          await adapter.findOne({
            model: "account",
            where: [
              {
                operator: "lt",
                connector: "AND",
                field: "accessTokenExpiresAt",
                value: Date.now(),
              },
              {
                operator: "ne",
                connector: "AND",
                field: "accessTokenExpiresAt",
                value: null,
              },
            ],
          }),
        ).toEqual(null);
      },

    // Better Auth's SQL adapters compare with NULL as SQL does: never true.
    // Convex orders null below every value, which used to make a null field
    // "less than" anything and any value "greater than" null.
    "should not match null in range comparisons": async () => {
      const now = Date.now();
      const nullRangeAccountId = `null-range-${now}-null`;
      const nonNullRangeAccountId = `null-range-${now}-non-null`;

      await adapter.create({
        model: "account",
        data: {
          accountId: nullRangeAccountId,
          providerId: "null-range-provider",
          userId: `null-range-user-${now}`,
          accessTokenExpiresAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });

      await adapter.create({
        model: "account",
        data: {
          accountId: nonNullRangeAccountId,
          providerId: "non-null-range-provider",
          userId: `non-null-range-user-${now}`,
          accessTokenExpiresAt: now + 1_000,
          createdAt: now,
          updatedAt: now,
        },
      });

      expect(
        await adapter.findOne({
          model: "account",
          where: [
            {
              field: "accessTokenExpiresAt",
              operator: "lt",
              connector: "AND",
              value: now,
            },
            {
              field: "accountId",
              operator: "eq",
              connector: "AND",
              value: nullRangeAccountId,
            },
          ],
        }),
      ).toEqual(null);

      expect(
        await adapter.findOne({
          model: "account",
          where: [
            {
              field: "accessTokenExpiresAt",
              operator: "lte",
              connector: "AND",
              value: now,
            },
            {
              field: "accountId",
              operator: "eq",
              connector: "AND",
              value: nullRangeAccountId,
            },
          ],
        }),
      ).toEqual(null);

      expect(
        await adapter.findOne({
          model: "account",
          where: [
            {
              field: "accessTokenExpiresAt",
              operator: "gt",
              connector: "AND",
              value: null,
            },
            {
              field: "accountId",
              operator: "eq",
              connector: "AND",
              value: nonNullRangeAccountId,
            },
          ],
        }),
      ).toEqual(null);

      expect(
        await adapter.findOne({
          model: "account",
          where: [
            {
              field: "accessTokenExpiresAt",
              operator: "gte",
              connector: "AND",
              value: null,
            },
            {
              field: "accountId",
              operator: "eq",
              connector: "AND",
              value: nonNullRangeAccountId,
            },
          ],
        }),
      ).toEqual(null);
    },

    "should fail to create a record with a unique field that already exists":
      async () => {
        await adapter.create({
          model: "user",
          data: { name: "foo", email: "foo@bar.com" },
        });
        await expect(
          adapter.create({
            model: "user",
            data: { name: "foo", email: "foo@bar.com" },
          }),
        ).rejects.toThrow("user email already exists");
      },

    "should be able to compare against a date": async () => {
      const now = new Date().toISOString();
      const user = await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
          createdAt: now,
        },
      });
      expect(
        await adapter.findOne({
          model: "user",
          where: [{ field: "createdAt", value: now }],
        }),
      ).toEqual(user);
      expect(typeof user.createdAt).toBe("number");
    },

    "should reject case-insensitive where clauses": async () => {
      await adapter.create({
        model: "user",
        data: {
          name: "foo",
          email: "foo@bar.com",
        },
      });
      await expect(
        adapter.findOne({
          model: "user",
          where: [
            {
              field: "email",
              value: "FOO@BAR.COM",
              operator: "eq",
              mode: "insensitive",
            },
          ],
        }),
      ).rejects.toThrow(/mode: "insensitive"/);
    },

    "should match unset optional fields against eq null and ne null":
      async () => {
        const now = Date.now();
        // Convex omits optional fields that were never written. Every other
        // adapter matches those against eq null (SQL IS NULL, Mongo
        // { field: null }), and Better Auth's atomic fallbacks guard on it.
        const unset = await adapter.create({
          model: "account",
          data: {
            accountId: `null-eq-${now}-unset`,
            providerId: "null-eq-provider",
            userId: `null-eq-user-${now}`,
            createdAt: now,
            updatedAt: now,
          },
        });
        const explicitNull = await adapter.create({
          model: "account",
          data: {
            accountId: `null-eq-${now}-null`,
            providerId: "null-eq-provider",
            userId: `null-eq-user-${now}`,
            accessTokenExpiresAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
        const nonNull = await adapter.create({
          model: "account",
          data: {
            accountId: `null-eq-${now}-non-null`,
            providerId: "null-eq-provider",
            userId: `null-eq-user-${now}`,
            accessTokenExpiresAt: now + 1_000,
            createdAt: now,
            updatedAt: now,
          },
        });
        const find = (id: string, operator: "eq" | "ne") =>
          adapter.findOne({
            model: "account",
            where: [
              { field: "id", value: id },
              { field: "accessTokenExpiresAt", operator, value: null },
            ],
          });
        expect(await find(unset.id, "eq")).toEqual(unset);
        expect(await find(explicitNull.id, "eq")).toEqual(explicitNull);
        expect(await find(nonNull.id, "eq")).toEqual(null);
        expect(await find(unset.id, "ne")).toEqual(null);
        expect(await find(explicitNull.id, "ne")).toEqual(null);
        expect(await find(nonNull.id, "ne")).toEqual(nonNull);
        // Static filter path (no unique or indexed clause)
        const ids = async (operator: "eq" | "ne") =>
          (
            await adapter.findMany<{ id: string }>({
              model: "account",
              where: [
                {
                  field: "providerId",
                  operator: "starts_with",
                  value: "null-eq-provider",
                },
                { field: "accessTokenExpiresAt", operator, value: null },
              ],
            })
          )
            .map((a) => a.id)
            .sort();
        expect(await ids("eq")).toEqual([unset.id, explicitNull.id].sort());
        expect(await ids("ne")).toEqual([nonNull.id]);
      },

    "should AND the OR group with the remaining where clauses": async () => {
      const alice = await adapter.create({
        model: "user",
        data: { name: "Alice", email: "alice@or-and.test" },
      });
      const bob = await adapter.create({
        model: "user",
        data: { name: "Bob", email: "bob@or-and.test" },
      });
      await adapter.create({
        model: "user",
        data: { name: "Alice", email: "alice@elsewhere.test" },
      });
      // (name = Alice OR name = Bob) AND email ends_with @or-and.test
      const where = [
        { field: "name", value: "Alice", connector: "OR" as const },
        { field: "name", value: "Bob", connector: "OR" as const },
        {
          field: "email",
          operator: "ends_with" as const,
          value: "@or-and.test",
        },
      ];
      expect(
        await adapter.findMany({
          model: "user",
          where,
          sortBy: { field: "name", direction: "asc" },
        }),
      ).toEqual([alice, bob]);
      expect(await adapter.count({ model: "user", where })).toEqual(2);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            { field: "name", value: "Nobody", connector: "OR" },
            { field: "name", value: "Bob", connector: "OR" },
            {
              field: "email",
              operator: "ends_with",
              value: "@or-and.test",
            },
          ],
        }),
      ).toEqual(bob);
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            { field: "name", value: "Nobody", connector: "OR" },
            { field: "name", value: "Alice", connector: "OR" },
            { field: "email", value: "nobody@or-and.test" },
          ],
        }),
      ).toEqual(null);
    },

    "should return null from findOne when no OR clause matches": async () => {
      expect(
        await adapter.findOne({
          model: "user",
          where: [
            { field: "name", value: "missing-one", connector: "OR" },
            { field: "name", value: "missing-two", connector: "OR" },
          ],
        }),
      ).toEqual(null);
    },

    "should only update and delete rows matching both the OR group and AND clauses":
      async () => {
        const target = await adapter.create({
          model: "user",
          data: { name: "mixed-write", email: "target@mixed-write.test" },
        });
        const excluded = await adapter.create({
          model: "user",
          data: { name: "mixed-write", email: "excluded@elsewhere.test" },
        });
        const where = [
          { field: "name", value: "mixed-write", connector: "OR" as const },
          { field: "name", value: "also-mixed", connector: "OR" as const },
          {
            field: "email",
            operator: "ends_with" as const,
            value: "@mixed-write.test",
          },
        ];
        expect(
          await adapter.updateMany({
            model: "user",
            where,
            update: { image: "updated" },
          }),
        ).toEqual(1);
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: excluded.id }],
          }),
        ).toEqual(excluded);
        expect(await adapter.deleteMany({ model: "user", where })).toEqual(1);
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: target.id }],
          }),
        ).toEqual(null);
        expect(
          await adapter.findOne({
            model: "user",
            where: [{ field: "id", value: excluded.id }],
          }),
        ).toEqual(excluded);
      },

    "should apply offset after sorting, including OR unions": async () => {
      const users = [];
      for (const letter of ["a", "b", "c", "d", "e"]) {
        users.push(
          await adapter.create({
            model: "user",
            data: { name: "offset-user", email: `${letter}@offset.test` },
          }),
        );
      }
      expect(
        await adapter.findMany({
          model: "user",
          where: [{ field: "name", value: "offset-user" }],
          sortBy: { field: "email", direction: "asc" },
          limit: 2,
          offset: 1,
        }),
      ).toEqual([users[1], users[2]]);
      expect(
        await adapter.findMany({
          model: "user",
          where: [{ field: "name", value: "offset-user" }],
          offset: 3,
        }),
      ).toEqual([users[3], users[4]]);
      // (email = a OR name = offset-user) AND email != e, sorted desc
      expect(
        await adapter.findMany({
          model: "user",
          where: [
            { field: "email", value: "a@offset.test", connector: "OR" },
            { field: "name", value: "offset-user", connector: "OR" },
            { field: "email", operator: "ne", value: "e@offset.test" },
          ],
          sortBy: { field: "email", direction: "desc" },
          limit: 2,
          offset: 1,
        }),
      ).toEqual([users[2], users[1]]);
      // "in" on ids and unique fields is looked up per value and limited in
      // the component, which must see offset + limit rows
      for (const field of ["id", "email"] as const) {
        expect(
          await adapter.findMany({
            model: "user",
            where: [
              {
                field,
                operator: "in",
                value: users.map((user: any) => user[field]),
              },
            ],
            sortBy: { field: "email", direction: "asc" },
            limit: 2,
            offset: 2,
          }),
        ).toEqual([users[2], users[3]]);
      }
    },

    "should not match an id from a different model": async () => {
      const user = await adapter.create({
        model: "user",
        data: {
          name: "cross-model",
          email: "cross@model.com",
        },
      });
      // user.id is a valid id, but of the user table. A lookup scoped to
      // another model must treat it as no match.
      expect(
        await adapter.findOne({
          model: "session",
          where: [{ field: "id", value: user.id }],
        }),
      ).toEqual(null);
      expect(
        await adapter.findMany({
          model: "session",
          where: [{ field: "id", operator: "in", value: [user.id] }],
        }),
      ).toEqual([]);
      expect(
        await adapter.update({
          model: "session",
          where: [{ field: "id", value: user.id }],
          update: { token: "hijacked" },
        }),
      ).toEqual(null);
      await adapter.delete({
        model: "session",
        where: [{ field: "id", value: user.id }],
      });
      expect(
        await adapter.findOne({
          model: "user",
          where: [{ field: "id", value: user.id }],
        }),
      ).toEqual(user);
    },
  }),
);
