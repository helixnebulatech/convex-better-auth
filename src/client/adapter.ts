import { createAdapterFactory } from "better-auth/adapters";
import type { DBAdapterDebugLogOption } from "better-auth/adapters";
import { createFunctionHandle } from "convex/server";
import type {
  FunctionHandle,
  GenericActionCtx,
  GenericDataModel,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
  WithoutSystemFields,
} from "convex/server";
import type { SetOptional } from "type-fest";
import type defaultSchema from "../component/schema.js";
import type { Where } from "better-auth/types";
import { asyncMap } from "convex-helpers";
import { prop, sortBy } from "remeda";
import { isRunMutationCtx } from "../utils/index.js";
import type { Doc, TableNames } from "../component/_generated/dataModel.js";
import type { ComponentApi } from "../component/_generated/component.js";
import type { AuthFunctions, GenericCtx, Triggers } from "./index.js";

let didWarnJoinsUnsupported = false;

const handlePagination = async (
  next: ({
    paginationOpts,
  }: {
    paginationOpts: PaginationOptions;
  }) => Promise<
    SetOptional<PaginationResult<any>, "page"> & { count?: number }
  >,
  { limit, numItems }: { limit?: number; numItems?: number } = {}
) => {
  const state: {
    isDone: boolean;
    cursor: string | null;
    docs: any[];
    count: number;
  } = {
    isDone: false,
    cursor: null,
    docs: [],
    count: 0,
  };
  const onResult = (
    result: SetOptional<PaginationResult<any>, "page"> & { count?: number }
  ) => {
    state.cursor =
      result.pageStatus === "SplitRecommended" ||
      result.pageStatus === "SplitRequired"
        ? (result.splitCursor ?? result.continueCursor)
        : result.continueCursor;
    if (result.page) {
      state.docs.push(...result.page);
      state.isDone = (limit && state.docs.length >= limit) || result.isDone;
      return;
    }
    // Update and delete only return a count
    if (result.count) {
      state.count += result.count;
      state.isDone = (limit && state.count >= limit) || result.isDone;
      return;
    }
    state.isDone = result.isDone;
  };

  do {
    const cursorBeforePage = state.cursor;
    const result = await next({
      paginationOpts: {
        // Subtract collected rows so the last page doesn't over-fetch past a
        // caller limit. No limit means an unbounded budget (Infinity, not 200,
        // or collecting 200 makes numItems 0 and the cursor never advances; #392).
        numItems: Math.min(
          numItems ?? 200,
          limit !== undefined ? limit - state.docs.length : Infinity,
          200
        ),
        cursor: state.cursor,
      },
    });
    onResult(result);
    // A page that returns nothing and doesn't advance the cursor while !isDone
    // can never terminate; fail loudly instead of looping forever.
    const advanced = state.cursor !== cursorBeforePage;
    const produced =
      (result.page?.length ?? 0) > 0 || (result.count ?? 0) > 0;
    if (!state.isDone && !advanced && !produced) {
      throw new Error(
        "handlePagination made no forward progress; aborting to avoid an infinite pagination loop"
      );
    }
  } while (!state.isDone);
  return state;
};

type ConvexCleanedWhere<TableName extends TableNames = TableNames> = Where & {
  value: string | number | boolean | string[] | number[] | null;
  field: keyof WithoutSystemFields<Doc<TableName>> & string;
};

const parseWhere = (
  where?: (Where & { join?: undefined }) | (Where & { join?: undefined })[]
): ConvexCleanedWhere[] => {
  if (!where) {
    return [];
  }
  const whereArray = Array.isArray(where) ? where : [where];
  for (const w of whereArray) {
    if (w.mode === "insensitive") {
      throw new Error(
        `Case-insensitive queries (mode: "insensitive") are not supported by the Convex adapter. Store values in a normalized form (e.g. lowercase on write) and query against the normalized value. Field: ${w.field}`
      );
    }
  }
  return whereArray.map((w) => {
    if (w.value instanceof Date) {
      return {
        ...w,
        value: w.value.getTime(),
      };
    }
    return w;
  }) as ConvexCleanedWhere[];
};

// Better Auth where semantics (as in the SQL and Mongo adapters): clauses with
// connector "OR" form one OR group that is AND'd with every other clause. The
// component only evaluates AND-only where lists, so split an OR where into one
// list per OR clause, each combined with all the AND clauses, and union the
// results. Returns undefined when there is no OR clause.
const splitOrWhere = (where?: (Where & { join?: undefined })[]) => {
  const orClauses = where?.filter((w) => w.connector === "OR") ?? [];
  if (!orClauses.length) {
    return;
  }
  const andClauses = where?.filter((w) => w.connector !== "OR") ?? [];
  return orClauses.map((w) => [
    { ...w, connector: "AND" as const },
    ...andClauses,
  ]);
};

type DocWithFlexibleId = {
  _id?: string | null;
  id?: string | null;
};

const getDocId = (doc: DocWithFlexibleId) => {
  if (doc?._id !== undefined && doc?._id !== null) {
    return String(doc._id);
  }
  if (doc?.id !== undefined && doc?.id !== null) {
    return String(doc.id);
  }
  return undefined;
};

const dedupeDocsById = <T extends DocWithFlexibleId>(docs: T[]) => {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const doc of docs) {
    const id = getDocId(doc);
    if (!id) {
      deduped.push(doc);
      continue;
    }
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    deduped.push(doc);
  }
  return deduped;
};

const selectDocFields = (
  doc: DocWithFlexibleId & Record<string, unknown>,
  select?: string[]
) => {
  if (!select?.length) {
    return doc;
  }
  return select.reduce(
    (acc, field) => {
      // Better Auth may request "id" while Convex stores it as "_id".
      // Keep "_id" so Better Auth output mapping can translate to "id".
      const sourceField = field === "id" && "_id" in doc ? "_id" : field;
      acc[sourceField] = doc[sourceField];
      return acc;
    },
    {} as Record<string, unknown>
  );
};

export const convexAdapter = <
  DataModel extends GenericDataModel,
  Ctx extends GenericCtx<DataModel> = GenericActionCtx<DataModel>,
  Schema extends SchemaDefinition<any, any> = typeof defaultSchema,
>(
  ctx: Ctx,
  api: {
    adapter: ComponentApi["adapter"];
  },
  config: {
    debugLogs?: DBAdapterDebugLogOption;
    authFunctions?: AuthFunctions;
    triggers?: Triggers<DataModel, Schema>;
  } = {}
) => {
  return createAdapterFactory({
    config: {
      adapterId: "convex",
      adapterName: "Convex Adapter",
      debugLogs: config.debugLogs || false,
      disableIdGeneration: true,
      transaction: false,
      supportsNumericIds: false,
      supportsJSON: false,
      supportsDates: false,
      supportsArrays: true,
      usePlural: false,
      mapKeysTransformInput: {
        id: "_id",
      },
      mapKeysTransformOutput: {
        _id: "id",
      },
      // Convert dates to numbers. This aligns with how
      // Convex stores _creationTime and avoids a breaking change.
      customTransformInput: ({ data, fieldAttributes }) => {
        if (data && fieldAttributes.type === "date") {
          return new Date(data).getTime();
        }
        return data;
      },
      customTransformOutput: ({ data, fieldAttributes }) => {
        if (data && fieldAttributes.type === "date") {
          return new Date(data).getTime();
        }
        return data;
      },
    },
    adapter: ({ options }) => {
      // Disable telemetry in all cases because it requires Node
      options.telemetry = { enabled: false };
      if (options.advanced?.database?.joins) {
        options.advanced = {
          ...options.advanced,
          database: { ...options.advanced.database, joins: false },
        };
        if (!didWarnJoinsUnsupported) {
          didWarnJoinsUnsupported = true;
          // eslint-disable-next-line no-console
          console.warn(
            "[convex-better-auth] Better Auth advanced.database.joins is not supported by the Convex adapter yet. Forcing advanced.database.joins = false."
          );
        }
      }

      const collectIdsForOrWhere = async (data: {
        model: string;
        orWhere: (Where & { join?: undefined })[][];
      }) => {
        const results = await asyncMap(data.orWhere, async (where) =>
          handlePagination(
            async ({ paginationOpts }) => {
              return await ctx.runQuery(api.adapter.findMany, {
                model: data.model as TableNames,
                where: parseWhere(where),
                paginationOpts,
              });
            }
          )
        );
        const ids = dedupeDocsById(results.flatMap((r) => r.docs))
          .map((doc) => getDocId(doc))
          .flatMap((id) => (id ? [id] : []));
        return ids;
      };

      return {
        id: "convex",
        options: {
          isRunMutationCtx: isRunMutationCtx(ctx),
        },
        createSchema: async ({ file, tables }) => {
          const { createSchema } = await import("./create-schema.js");
          return createSchema({ file, tables });
        },
        create: async ({ model, data, select }): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onCreateHandle =
            config.authFunctions?.onCreate && config.triggers?.[model]?.onCreate
              ? ((await createFunctionHandle(
                  config.authFunctions.onCreate
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.create, {
            input: { model: model as any, data: data as any },
            select,
            onCreateHandle: onCreateHandle,
          });
        },
        // Better Auth 1.7.6+ passes modelKey, which the component validators reject
        findOne: async ({ modelKey: _modelKey, ...data }): Promise<any> => {
          const orWhere = splitOrWhere(data.where);
          if (orWhere) {
            for (const where of orWhere) {
              const result = await ctx.runQuery(api.adapter.findOne, {
                ...data,
                model: data.model as TableNames,
                where: parseWhere(where),
              });
              if (result) {
                return result;
              }
            }
            return null;
          }
          return await ctx.runQuery(api.adapter.findOne, {
            ...data,
            model: data.model as TableNames,
            where: parseWhere(data.where),
          });
        },
        findMany: async ({
          modelKey: _modelKey,
          offset = 0,
          ...data
        }): Promise<any[]> => {
          // The component paginates by cursor only, so fetch offset + limit
          // rows and drop the first offset here. Deep offsets read every
          // skipped row.
          const limit =
            data.limit !== undefined ? data.limit + offset : undefined;

          const orWhere = splitOrWhere(data.where);
          if (orWhere) {
            // Always fetch full docs for OR unions so we can dedupe
            // by id and sort/limit before trimming selected fields.
            const { select: _ignoredSelect, ...queryData } = data;
            const results = await asyncMap(orWhere, async (where) =>
              handlePagination(
                async ({ paginationOpts }) => {
                  return await ctx.runQuery(api.adapter.findMany, {
                    ...queryData,
                    model: data.model as TableNames,
                    where: parseWhere(where),
                    paginationOpts,
                  });
                },
                { limit }
              )
            );
            let docs = dedupeDocsById(results.flatMap((r) => r.docs));
            if (data.sortBy) {
              docs = sortBy(docs, [
                prop(data.sortBy.field),
                data.sortBy.direction,
              ]);
            }
            docs = docs.slice(offset, limit);
            return docs.map((doc) => selectDocFields(doc, data.select));
          }

          const result = await handlePagination(
            async ({ paginationOpts }) => {
              return await ctx.runQuery(api.adapter.findMany, {
                ...data,
                model: data.model as TableNames,
                where: parseWhere(data.where),
                paginationOpts,
              });
            },
            { limit }
          );
          return offset ? result.docs.slice(offset) : result.docs;
        },
        count: async ({ modelKey: _modelKey, ...data }) => {
          // Yes, count is just findMany returning a number.
          const orWhere = splitOrWhere(data.where);
          if (orWhere) {
            const results = await asyncMap(orWhere, async (where) =>
              handlePagination(async ({ paginationOpts }) => {
                return await ctx.runQuery(api.adapter.findMany, {
                  ...data,
                  model: data.model as TableNames,
                  where: parseWhere(where),
                  paginationOpts,
                });
              })
            );
            const docs = dedupeDocsById(results.flatMap((r) => r.docs));
            return docs.length;
          }

          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runQuery(api.adapter.findMany, {
              ...data,
              model: data.model as TableNames,
              where: parseWhere(data.where),
              paginationOpts,
            });
          });
          return result.docs.length;
        },
        update: async (data): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          // An empty where matches no single record, so there's nothing to
          // update. better-auth's adapter contract expects null here.
          if (!data.where?.length) {
            return null;
          }
          if (data.where.some((w) => w.connector === "OR")) {
            throw new Error("where clause not supported");
          }
          const onUpdateHandle =
            config.authFunctions?.onUpdate &&
            config.triggers?.[data.model]?.onUpdate
              ? ((await createFunctionHandle(
                  config.authFunctions.onUpdate
                )) as FunctionHandle<"mutation">)
              : undefined;
          return ctx.runMutation(api.adapter.updateOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
              update: data.update as any,
            },
            onUpdateHandle: onUpdateHandle,
          });
        },
        delete: async (data) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          await ctx.runMutation(api.adapter.deleteOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
            },
            onDeleteHandle: onDeleteHandle,
          });
        },
        // deleteOne finds and deletes in a single mutation, which is atomic.
        // Better Auth's fallback guards on every row field, including
        // _creationTime, which the component where validators reject.
        consumeOne: async (data): Promise<any> => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          if (data.where.some((w) => w.connector === "OR")) {
            throw new Error("where clause not supported");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          const doc = await ctx.runMutation(api.adapter.deleteOne, {
            input: {
              model: data.model as TableNames,
              where: parseWhere(data.where),
            },
            onDeleteHandle: onDeleteHandle,
          });
          return doc ?? null;
        },
        deleteMany: async ({ modelKey: _modelKey, ...data }) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onDeleteHandle =
            config.authFunctions?.onDelete &&
            config.triggers?.[data.model as TableNames]?.onDelete
              ? ((await createFunctionHandle(
                  config.authFunctions.onDelete
                )) as FunctionHandle<"mutation">)
              : undefined;
          const orWhere = splitOrWhere(data.where);
          if (orWhere) {
            const ids = await collectIdsForOrWhere({
              model: data.model as string,
              orWhere,
            });
            await asyncMap(ids, async (id) => {
              await ctx.runMutation(api.adapter.deleteOne, {
                input: {
                  model: data.model as TableNames,
                  where: [{ field: "_id", operator: "eq", value: id }],
                },
                onDeleteHandle: onDeleteHandle,
              });
            });
            return ids.length;
          }
          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runMutation(api.adapter.deleteMany, {
              input: {
                ...data,
                model: data.model as TableNames,
                where: parseWhere(data.where),
              },
              paginationOpts,
              onDeleteHandle: onDeleteHandle,
            });
          });
          return result.count;
        },
        updateMany: async ({ modelKey: _modelKey, ...data }) => {
          if (!("runMutation" in ctx)) {
            throw new Error("ctx is not a mutation ctx");
          }
          const onUpdateHandle =
            config.authFunctions?.onUpdate &&
            config.triggers?.[data.model]?.onUpdate
              ? ((await createFunctionHandle(
                  config.authFunctions.onUpdate
                )) as FunctionHandle<"mutation">)
              : undefined;
          const orWhere = splitOrWhere(data.where);
          if (orWhere) {
            const ids = await collectIdsForOrWhere({
              model: data.model as string,
              orWhere,
            });
            if (!ids.length) {
              return 0;
            }
            const result = await handlePagination(
              async ({ paginationOpts }) => {
                return await ctx.runMutation(api.adapter.updateMany, {
                  input: {
                    model: data.model as TableNames,
                    where: [{ field: "_id", operator: "in", value: ids }],
                    update: data.update,
                  },
                  paginationOpts,
                  onUpdateHandle: onUpdateHandle,
                });
              },
              { limit: ids.length }
            );
            return result.count ?? 0;
          }
          const result = await handlePagination(async ({ paginationOpts }) => {
            return await ctx.runMutation(api.adapter.updateMany, {
              input: {
                ...data,
                model: data.model as TableNames,
                where: parseWhere(data.where),
              },
              paginationOpts,
              onUpdateHandle: onUpdateHandle,
            });
          });
          return result.count;
        },
      };
    },
  });
};
