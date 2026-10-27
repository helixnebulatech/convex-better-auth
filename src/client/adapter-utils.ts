import { asyncMap } from "convex-helpers";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import type {
  DocumentByName,
  GenericDataModel,
  GenericQueryCtx,
  PaginationOptions,
  PaginationResult,
  SchemaDefinition,
  TableNamesInDataModel,
} from "convex/server";
import { stream } from "convex-helpers/server/stream";
import { mergedStream } from "convex-helpers/server/stream";
import { stripIndent } from "common-tags";
import type { BetterAuthDBSchema } from "better-auth/db";
import { customIdField } from "./create-schema.js";

export const adapterWhereValidator = v.object({
  field: v.string(),
  operator: v.optional(
    v.union(
      v.literal("lt"),
      v.literal("lte"),
      v.literal("gt"),
      v.literal("gte"),
      v.literal("eq"),
      v.literal("in"),
      v.literal("not_in"),
      v.literal("ne"),
      v.literal("contains"),
      v.literal("starts_with"),
      v.literal("ends_with")
    )
  ),
  value: v.union(
    v.string(),
    v.number(),
    v.boolean(),
    v.array(v.string()),
    v.array(v.number()),
    v.null()
  ),
  connector: v.optional(v.union(v.literal("AND"), v.literal("OR"))),
  mode: v.optional(v.union(v.literal("sensitive"), v.literal("insensitive"))),
});

export const adapterArgsValidator = v.object({
  model: v.string(),
  where: v.optional(v.array(adapterWhereValidator)),
  sortBy: v.optional(
    v.object({
      field: v.string(),
      direction: v.union(v.literal("asc"), v.literal("desc")),
    })
  ),
  select: v.optional(v.array(v.string())),
  limit: v.optional(v.number()),
  offset: v.optional(v.number()),
});

// Unique constraints of a model, as lists of database field names. Better Auth
// declares them on fields (`unique: true`) and, since 1.7, as table-level
// indexes (`indexes: [{ fields, unique: true }]`), which can be compound.
const getUniqueConstraints = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string
) => {
  const table = Object.values(betterAuthSchema).find(
    (value) => value.modelName === model
  );
  if (!table) {
    return [];
  }
  const fieldConstraints = Object.entries(table.fields)
    .filter(([, value]) => value.unique)
    .map(([key, value]) => [value.fieldName ?? key]);
  const indexConstraints = (table.indexes ?? [])
    .filter((index) => index.unique)
    .map((index) =>
      index.fields.map((field) => table.fields[field]?.fieldName ?? field)
    );
  return [...fieldConstraints, ...indexConstraints];
};
const isUniqueField = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  field: string
) =>
  Object.entries(
    Object.values(betterAuthSchema).find((value) => value.modelName === model)
      ?.fields ?? {}
  ).some(([key, value]) => value.unique && (value.fieldName ?? key) === field);
// Whether the input sets every field of a unique constraint, so it can't be
// written to more than one document.
export const hasUniqueFields = (
  betterAuthSchema: BetterAuthDBSchema,
  model: string,
  input: Record<string, any>
) =>
  getUniqueConstraints(betterAuthSchema, model).some((constraint) =>
    constraint.every((field) => input[field] != null)
  );

const findIndex = (
  schema: SchemaDefinition<any, any>,
  args: {
    model: string;
    where?: {
      field: string;
      operator?:
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "eq"
        | "in"
        | "not_in"
        | "ne"
        | "contains"
        | "starts_with"
        | "ends_with";
      value: string | number | boolean | null | string[] | number[];
      connector?: "AND" | "OR";
      mode?: "sensitive" | "insensitive";
    }[];
    sortBy?: {
      field: string;
      direction: "asc" | "desc";
    };
  }
) => {
  if (
    (args.where?.length ?? 0) > 1 &&
    args.where?.some((w) => w.connector === "OR")
  ) {
    throw new Error(
      `OR connector not supported with multiple where statements in findIndex, split up the where statements before calling findIndex: ${JSON.stringify(args.where)}`
    );
  }
  const where = args.where?.filter((w) => {
    return (
      (!w.operator ||
        ["lt", "lte", "gt", "gte", "eq", "in", "not_in"].includes(
          w.operator
        )) &&
      w.field !== "_id"
    );
  });
  if (!where?.length && !args.sortBy) {
    return;
  }
  const lowerBounds =
    where?.filter((w) => w.operator === "lt" || w.operator === "lte") ?? [];
  if (lowerBounds.length > 1) {
    throw new Error(
      `cannot have more than one lower bound where clause: ${JSON.stringify(where)}`
    );
  }
  const upperBounds =
    where?.filter((w) => w.operator === "gt" || w.operator === "gte") ?? [];
  if (upperBounds.length > 1) {
    throw new Error(
      `cannot have more than one upper bound where clause: ${JSON.stringify(where)}`
    );
  }
  const lowerBound = lowerBounds[0];
  const upperBound = upperBounds[0];
  if (lowerBound && upperBound && lowerBound.field !== upperBound.field) {
    throw new Error(
      `lower bound and upper bound must have the same field: ${JSON.stringify(where)}`
    );
  }
  const boundField = lowerBound?.field || upperBound?.field;
  if (
    boundField &&
    where?.some(
      (w) => w.field === boundField && w !== lowerBound && w !== upperBound
    )
  ) {
    throw new Error(
      `too many where clauses on the bound field: ${JSON.stringify(where)}`
    );
  }
  const indexEqFields =
    where
      ?.filter((w) => !w.operator || w.operator === "eq")
      .sort((a, b) => {
        return a.field.localeCompare(b.field);
      })
      .map((w) => [w.field, w.value]) ?? [];
  if (!indexEqFields?.length && !boundField && !args.sortBy) {
    return;
  }
  const table = schema.tables[args.model as keyof typeof schema.tables];
  if (!table) {
    throw new Error(`Table ${args.model} not found`);
  }
  const indexes = table[" indexes"]();
  const sortField = args.sortBy?.field;

  // We internally use _creationTime in place of Better Auth's createdAt
  const indexFields = indexEqFields
    .map(([field]) => field)
    .concat(boundField && boundField !== "createdAt" ? boundField : "")
    .concat(
      sortField && sortField !== "createdAt" && boundField !== sortField
        ? sortField
        : ""
    )
    .filter(Boolean);
  if (!indexFields.length && !boundField && !sortField) {
    return;
  }
  // Use the built in _creationTime index if bounding or sorting by createdAt
  // with no other fields
  const index = !indexFields.length
    ? {
        indexDescriptor: "by_creation_time",
        fields: [],
      }
    : indexes.find(({ fields }: { fields: string[] }) => {
        const fieldsMatch = indexFields.every(
          (field, idx) => field === fields[idx]
        );
        // If sorting by createdAt, no intermediate fields can be on the index
        // as they may override the createdAt sort order.
        const boundFieldMatch =
          boundField === "createdAt" || sortField === "createdAt"
            ? indexFields.length === fields.length
            : true;
        return fieldsMatch && boundFieldMatch;
      });
  if (!index) {
    return { indexFields };
  }
  return {
    index: {
      indexDescriptor: index.indexDescriptor,
      fields: [...index.fields, "_creationTime"],
    },
    boundField,
    sortField,
    values: {
      eq: indexEqFields.map(([, value]) => value),
      lt: lowerBound?.operator === "lt" ? lowerBound.value : undefined,
      lte: lowerBound?.operator === "lte" ? lowerBound.value : undefined,
      gt: upperBound?.operator === "gt" ? upperBound.value : undefined,
      gte: upperBound?.operator === "gte" ? upperBound.value : undefined,
    },
  };
};

export const checkUniqueFields = async <
  Schema extends SchemaDefinition<any, any>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: Schema,
  betterAuthSchema: BetterAuthDBSchema,
  table: string,
  input: Record<string, any>,
  doc?: Record<string, any>
) => {
  // Check the document as it will be after the write, so updating one field
  // of a compound constraint is checked together with the others.
  const mergedDoc = { ...doc, ...input };
  for (const constraint of getUniqueConstraints(betterAuthSchema, table)) {
    // A null or unset field never conflicts, as NULL in a unique column in
    // the SQL databases behind Better Auth's Drizzle, Prisma and Kysely
    // adapters
    if (
      !constraint.some((field) => field in input) ||
      constraint.some((field) => mergedDoc[field] == null)
    ) {
      continue;
    }
    const constraintName =
      constraint.length === 1
        ? constraint[0]
        : `unique constraint ${constraint.join("+")}`;
    const { index, values } =
      findIndex(schema, {
        model: table,
        where: constraint.map((field) => ({
          field,
          operator: "eq" as const,
          value: mergedDoc[field],
        })),
      }) || {};
    const query = ctx.db.query(table as any);
    let existingDocs;
    if (index && values) {
      existingDocs = await query
        .withIndex(index.indexDescriptor, (q) =>
          values.eq.reduce(
            (q: any, value, idx) => q.eq(index.fields[idx], value),
            q
          )
        )
        .take(2);
    } else {
      // Schemas generated before table-level indexes were supported have no
      // index for those constraints, scan rather than fail the write.
      // eslint-disable-next-line no-console
      console.warn(
        `No index found for ${table} ${constraintName}, regenerate the Better Auth schema to add it.`
      );
      existingDocs = await query
        // eslint-disable-next-line @convex-dev/no-filter-in-query
        .filter((q) =>
          q.and(
            ...constraint.map((field) => q.eq(q.field(field), mergedDoc[field]))
          )
        )
        .take(2);
    }
    if (existingDocs.some((existingDoc) => existingDoc._id !== doc?._id)) {
      throw new Error(`${table} ${constraintName} already exists`);
    }
  }
};

// This handles basic select (stripping out the other fields if there
// is a select arg).
export const selectFields = <
  T extends TableNamesInDataModel<GenericDataModel>,
  D extends DocumentByName<GenericDataModel, T>,
>(
  doc: D | null,
  select?: string[]
) => {
  if (!doc) {
    return null;
  }
  if (!select?.length) {
    return doc;
  }
  return select.reduce((acc, field) => {
    // Better Auth may request "id" while Convex stores it as "_id".
    // Keep the raw field key here and let Better Auth map "_id" -> "id".
    const sourceField = field === "id" && "_id" in doc ? "_id" : field;
    (acc as any)[sourceField] = doc[sourceField as keyof typeof doc];
    return acc;
  }, {} as D);
};

// Manually filter an individual document by where clauses. This is used to
// simplify queries that can only return 0 or 1 documents, or "in" clauses that
// query multiple single documents in parallel.
const filterByWhere = <
  T extends TableNamesInDataModel<GenericDataModel>,
  D extends DocumentByName<GenericDataModel, T>,
>(
  doc: D | null,
  where?: Infer<typeof adapterWhereValidator>[],
  // Optionally filter which where clauses to apply.
  filterWhere?: (w: Infer<typeof adapterWhereValidator>) => any
) => {
  if (!doc) {
    return false;
  }
  for (const w of where ?? []) {
    if (filterWhere && !filterWhere(w)) {
      continue;
    }
    const value = doc[w.field as keyof typeof doc] as Infer<
      typeof adapterWhereValidator
    >["value"];
    // Convex omits optional fields that were never written, so an unset
    // field reads as undefined. Both stand for SQL NULL here.
    const isNullish = (val: unknown) => val === undefined || val === null;
    // As in Better Auth's SQL adapters, a comparison with NULL on either side
    // is never true: only eq/ne null (IS NULL / IS NOT NULL) match on null.
    const isComparable = (val: typeof value, wVal: typeof w.value) =>
      !isNullish(val) && !isNullish(wVal);
    const isLessThan = (val: typeof value, wVal: typeof w.value) =>
      isComparable(val, wVal) && val! < wVal!;
    const isGreaterThan = (val: typeof value, wVal: typeof w.value) =>
      isComparable(val, wVal) && val! > wVal!;
    // A row created with an id Better Auth chose is found by that id too,
    // kept in customId, as by getDocById
    const ids =
      w.field === "_id"
        ? [doc._id, (doc as any)[customIdField]].filter(
            (id) => id !== undefined
          )
        : undefined;
    const filter = (w: Infer<typeof adapterWhereValidator>) => {
      switch (w.operator) {
        case undefined:
        case "eq": {
          if (ids) {
            return ids.includes(w.value);
          }
          return w.value === null ? isNullish(value) : value === w.value;
        }
        case "in": {
          if (ids) {
            return (
              Array.isArray(w.value) &&
              ids.some((id) => (w.value as any[]).includes(id))
            );
          }
          return Array.isArray(w.value) && (w.value as any[]).includes(value);
        }
        case "not_in": {
          if (ids) {
            return (
              Array.isArray(w.value) &&
              !ids.some((id) => (w.value as any[]).includes(id))
            );
          }
          // SQL NOT IN excludes rows where the field is NULL.
          return (
            Array.isArray(w.value) &&
            !isNullish(value) &&
            !(w.value as any[]).includes(value)
          );
        }
        case "lt": {
          return isLessThan(value, w.value);
        }
        case "lte": {
          return (
            isComparable(value, w.value) &&
            (value === w.value || isLessThan(value, w.value))
          );
        }
        case "gt": {
          return isGreaterThan(value, w.value);
        }
        case "gte": {
          return (
            isComparable(value, w.value) &&
            (value === w.value || isGreaterThan(value, w.value))
          );
        }
        case "ne": {
          if (ids) {
            return !ids.includes(w.value);
          }
          // ne null is IS NOT NULL; otherwise SQL <> excludes NULL rows.
          return !isNullish(value) && value !== w.value;
        }
        case "contains": {
          return typeof value === "string" && value.includes(w.value as string);
        }
        case "starts_with": {
          return (
            typeof value === "string" && value.startsWith(w.value as string)
          );
        }
        case "ends_with": {
          return typeof value === "string" && value.endsWith(w.value as string);
        }
      }
    };
    if (!filter(w)) {
      return false;
    }
  }
  return true;
};

// An index range on eq null only matches explicit nulls, not documents where
// the optional field was never written, so these clauses are applied
// statically instead (see filterByWhere).
const isEqNull = (w: Infer<typeof adapterWhereValidator>) =>
  (!w.operator || w.operator === "eq") && w.value === null;

// Convex orders null below every other value, so an index range against null
// would match documents a SQL comparison with NULL never does. Applied
// statically, these clauses match nothing (see filterByWhere).
const isRangeNull = (w: Infer<typeof adapterWhereValidator>) =>
  (w.operator === "lt" ||
    w.operator === "lte" ||
    w.operator === "gt" ||
    w.operator === "gte") &&
  w.value === null;

const generateQuery = (
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  args: Infer<typeof adapterArgsValidator>
) => {
  const { index, values, boundField, indexFields } =
    findIndex(schema, {
      ...args,
      where: args.where?.filter((w) => !isEqNull(w)),
    }) ?? {};
  const usableIndex =
    index?.indexDescriptor === "by_creation_time" ? undefined : index;
  const query = stream(ctx.db as any, schema).query(args.model as any);
  const hasValues =
    (values?.eq?.length ?? 0) > 0 ||
    values?.lt !== undefined ||
    values?.lte !== undefined ||
    values?.gt !== undefined ||
    values?.gte !== undefined;
  const indexedQuery = usableIndex
    ? query.withIndex(
        usableIndex.indexDescriptor,
        hasValues
          ? (q: any) => {
              for (const [idx, value] of (values?.eq ?? []).entries()) {
                q = q.eq(usableIndex.fields[idx], value);
              }
              // createdAt isn't an index field, the index ends in
              // _creationTime, which can differ from a createdAt Better Auth
              // set. Its bounds are applied to the stored value below.
              if (boundField === "createdAt") {
                return q;
              }
              if (values?.gt !== undefined) {
                q = q.gt(boundField, values.gt);
              } else if (values?.gte !== undefined) {
                q = q.gte(boundField, values.gte);
              } else if (
                boundField !== "createdAt" &&
                (values?.lt !== undefined || values?.lte !== undefined)
              ) {
                // Convex orders undefined < null < every other value, so an
                // upper bound alone would also match null and unset fields.
                q = q.gt(boundField, null);
              }
              if (values?.lt !== undefined) {
                q = q.lt(boundField, values.lt);
              }
              if (values?.lte !== undefined) {
                q = q.lte(boundField, values.lte);
              }
              return q;
            }
          : undefined
      )
    : query;
  const orderedQuery = args.sortBy
    ? indexedQuery.order(args.sortBy.direction === "desc" ? "desc" : "asc")
    : indexedQuery;
  if (!usableIndex && indexFields?.length) {
    // eslint-disable-next-line no-console
    console.warn(
      stripIndent`
        Querying without an index on table "${args.model}".
        This can cause performance issues, and may hit the document read limit.
        To fix, add an index that begins with the following fields in order:
        [${indexFields.join(", ")}]
      `
    );
  }
  const filteredQuery = orderedQuery.filterWith(async (doc) => {
    if (!usableIndex) {
      // No usable index, handle all where clauses statically.
      return filterByWhere(doc, args.where);
    }
    return filterByWhere(
      doc,
      args.where,
      // Index used for all eq and range clauses, apply remaining clauses
      // incompatible with Convex statically.
      (w) =>
        isEqNull(w) ||
        isRangeNull(w) ||
        (w.field === "createdAt" &&
          ["lt", "lte", "gt", "gte"].includes(w.operator ?? "")) ||
        (w.operator &&
          ["contains", "starts_with", "ends_with", "ne", "not_in"].includes(
            w.operator
          ))
    );
  });
  return filteredQuery;
};

// Whether the table stores ids chosen by Better Auth in customId (see
// customIdTables in create-schema.ts). Schemas generated before customId
// existed don't have it.
export const hasCustomIdIndex = (
  schema: SchemaDefinition<any, any>,
  model: string
) =>
  Boolean(
    schema.tables[model]?.[" indexes"]?.().some(
      (index: { indexDescriptor: string; fields: string[] }) =>
        index.indexDescriptor === customIdField &&
        index.fields.length === 1 &&
        index.fields[0] === customIdField
    )
  );

// Resolve an _id where value within the requested model. normalizeId returns
// null for ids of other tables and for strings that aren't Convex ids at all
// (better-auth's adapter tests pass UUIDs), and both mean "no match". A bare
// ctx.db.get(id) would return a document from whatever table the id is in.
// Ids Better Auth chose itself live in customId, so look there too.
export const getDocById = async <
  T extends TableNamesInDataModel<GenericDataModel>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  model: T,
  value: unknown
) => {
  if (typeof value !== "string") {
    return null;
  }
  const id = ctx.db.normalizeId(model, value);
  const doc = id ? await ctx.db.get(model, id) : null;
  if (doc || !hasCustomIdIndex(schema, model)) {
    return doc;
  }
  return await ctx.db
    .query(model as any)
    .withIndex(customIdField as any, (q) => q.eq(customIdField, value))
    .unique();
};

// This is the core function for reading from the database, it parses and
// validates where conditions, selects indexes, and allows the caller to
// optionally paginate as needed. Every response is a pagination result.
// Convex's order for index fields: undefined, then null, then values, and
// values by type, then by value
const typeRank = (value: unknown) =>
  value === undefined
    ? 0
    : value === null
      ? 1
      : typeof value === "bigint"
        ? 2
        : typeof value === "number"
          ? 3
          : typeof value === "boolean"
            ? 4
            : typeof value === "string"
              ? 5
              : 6;
export const compareValues = (a: unknown, b: unknown) => {
  const rank = typeRank(a) - typeRank(b);
  if (rank !== 0) {
    return rank;
  }
  if (a === b || typeRank(a) <= 1) {
    return 0;
  }
  return (a as any) < (b as any) ? -1 : (a as any) > (b as any) ? 1 : 0;
};

// Sorting by createdAt or the creation order uses _creationTime
const isCreationSort = (field: string) =>
  field === "createdAt" || field === "_creationTime";

export const paginate = async <
  Doc extends DocumentByName<GenericDataModel, T>,
  T extends TableNamesInDataModel<GenericDataModel>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  betterAuthSchema: BetterAuthDBSchema,
  args: Infer<typeof adapterArgsValidator> & {
    paginationOpts: PaginationOptions;
  }
): Promise<PaginationResult<Doc>> => {
  if (args.offset) {
    throw new Error(`offset not supported: ${JSON.stringify(args.offset)}`);
  }
  if (args.where?.some((w) => w.connector === "OR") && args.where?.length > 1) {
    throw new Error(
      `OR connector not supported with multiple where statements in paginate, split up the where statements before calling paginate: ${JSON.stringify(args.where)}`
    );
  }
  if (
    args.where?.some(
      (w) =>
        w.field === "_id" &&
        w.operator &&
        !["eq", "in", "not_in", "ne"].includes(w.operator)
    )
  ) {
    throw new Error(
      `_id can only be used with eq, in, not_in or ne operator: ${JSON.stringify(args.where)}`
    );
  }
  if (args.where?.some((w) => w.mode === "insensitive")) {
    throw new Error(
      `Case-insensitive queries (mode: "insensitive") are not supported by the Convex adapter. Store values in a normalized form (e.g. lowercase on write) and query against the normalized value.`
    );
  }
  // If any where clause is "eq" (or missing operator) on a unique field,
  // we can only return a single document, so we get it and use any other
  // where clauses as static filters. Several documents can have a null or
  // unset unique field, so eq null isn't a unique lookup.
  const uniqueWhere = args.where?.find(
    (w) =>
      (!w.operator || w.operator === "eq") &&
      (w.field === "_id" ||
        (w.value !== null &&
          isUniqueField(betterAuthSchema, args.model, w.field)))
  );
  if (uniqueWhere) {
    const { index } =
      findIndex(schema, {
        model: args.model,
        where: [uniqueWhere],
      }) || {};
    if (uniqueWhere.field !== "_id" && !index) {
      throw new Error(`No index found for ${args.model}.${uniqueWhere.field}`);
    }
    const doc =
      uniqueWhere.field === "_id"
        ? await getDocById(ctx, schema, args.model as T, uniqueWhere.value)
        : await ctx.db
            .query(args.model as any)
            .withIndex(index?.indexDescriptor as any, (q) =>
              q.eq(index?.fields[0], uniqueWhere.value)
            )
            .unique();

    // Apply all other clauses as static filters to our 0 or 1 result.
    if (filterByWhere(doc, args.where, (w) => w !== uniqueWhere)) {
      return {
        page: [selectFields(doc, args.select)].filter(Boolean) as Doc[],
        isDone: true,
        continueCursor: "",
      };
    }
    return {
      page: [],
      isDone: true,
      continueCursor: "",
    };
  }

  const paginationOpts = {
    ...args.paginationOpts,
    // If maximumRowsRead is not at least 1 higher than numItems, bad cursors
    // and incorrect paging will result (at least with convex-test).
    maximumRowsRead: Math.max((args.paginationOpts.numItems ?? 0) + 1, 200),
  };

  // Without an index ending in the sort field, the query would come back in
  // creation order and the limit would keep the wrong rows. Better Auth's SQL
  // adapters sort anyway (ORDER BY without an index), so read every matching
  // row and sort here. On a large table this can hit Convex's read limit,
  // which fails instead of returning the wrong rows.
  const sortsInMemory = async (inWhere?: (typeof args.where & {})[number]) =>
    Boolean(
      args.sortBy &&
      !isCreationSort(args.sortBy.field) &&
      !findIndex(schema, {
        model: args.model,
        where: args.where?.map((w) =>
          w === inWhere ? { ...w, operator: "eq" as const } : w
        ),
        sortBy: args.sortBy,
      })?.index
    );
  const sortInMemory = async (): Promise<PaginationResult<Doc>> => {
    const sortBy = args.sortBy!;
    const docs: Doc[] = [];
    let cursor: string | null = null;
    for (;;) {
      const result: PaginationResult<Doc> = await paginate(
        ctx,
        schema,
        betterAuthSchema,
        {
          ...args,
          sortBy: undefined,
          select: undefined,
          limit: undefined,
          paginationOpts: { numItems: 200, cursor },
        }
      );
      docs.push(...result.page);
      if (result.isDone || result.continueCursor === cursor) {
        break;
      }
      cursor = result.continueCursor;
    }
    const direction = sortBy.direction === "desc" ? -1 : 1;
    const sorted = docs.sort(
      (a, b) =>
        direction *
          compareValues(
            a[sortBy.field as keyof Doc],
            b[sortBy.field as keyof Doc]
          ) ||
        direction * ((a._creationTime as number) - (b._creationTime as number))
    );
    return {
      page: sorted
        .slice(0, args.limit ?? sorted.length)
        .map((doc) => selectFields(doc, args.select)) as Doc[],
      isDone: true,
      continueCursor: "",
    };
  };

  // Large queries using "in" clause will crash, but these are only currently
  // possible with the organization plugin listing all members with a high
  // limit. For cases like this we need to create proper convex queries in
  // the component as an alternative to using Better Auth api's.
  const foundInWhere = args.where?.find((w) => w.operator === "in");
  if (foundInWhere) {
    if (!Array.isArray(foundInWhere.value)) {
      throw new Error("in clause value must be an array");
    }
    // Like SQL IN, a value listed twice matches its rows once
    const inWhere = {
      ...foundInWhere,
      value: [...new Set(foundInWhere.value as (string | number)[])],
    } as typeof foundInWhere & { value: any[] };
    args = {
      ...args,
      where: args.where?.map((w) => (w === foundInWhere ? inWhere : w)),
    };
    // Ids and unique fields match at most one document per value, so look
    // each value up directly and apply the other clauses as static filters.
    // Streaming per value would need an index covering every other clause
    // (eg. multi-session's token "in" + expiresAt "gt"), or scan the table.
    // Unique fields without an index, or with null values (which several
    // documents can share), fall back to streaming below.
    const { index: uniqueIndex } =
      (inWhere.field !== "_id" &&
        inWhere.value.every((value) => value !== null) &&
        isUniqueField(betterAuthSchema, args.model, inWhere.field) &&
        findIndex(schema, {
          model: args.model,
          where: [{ ...inWhere, operator: "eq" }],
        })) ||
      {};
    if (inWhere.field === "_id" || uniqueIndex) {
      const docs = await asyncMap(inWhere.value as any[], async (value) => {
        if (uniqueIndex) {
          return await ctx.db
            .query(args.model as any)
            .withIndex(uniqueIndex.indexDescriptor as any, (q) =>
              q.eq(uniqueIndex.fields[0], value)
            )
            .unique();
        }
        return getDocById(ctx, schema, args.model as T, value);
      });
      const filteredDocs = docs
        .flatMap((doc) => (doc ? [doc] : []))
        .filter((doc) => filterByWhere(doc, args.where, (w) => w !== inWhere));

      return {
        page: filteredDocs
          .sort((a, b) => {
            if (args.sortBy?.field === "createdAt") {
              return args.sortBy.direction === "asc"
                ? (a._creationTime as number) - (b._creationTime as number)
                : (b._creationTime as number) - (a._creationTime as number);
            }
            if (args.sortBy) {
              const aValue = a[args.sortBy.field as keyof typeof a];
              const bValue = b[args.sortBy.field as keyof typeof b];
              if (aValue === bValue) {
                return 0;
              }
              return args.sortBy.direction === "asc"
                ? aValue! > bValue!
                  ? 1
                  : -1
                : aValue! > bValue!
                  ? -1
                  : 1;
            }
            return 0;
          })
          .slice(0, args.limit)
          .map((doc) => selectFields(doc, args.select))
          .flatMap((doc) => (doc ? [doc] : [])) as Doc[],
        isDone: true,
        continueCursor: "",
      };
    }
    if (await sortsInMemory(inWhere)) {
      return await sortInMemory();
    }
    const streams = inWhere.value.map((value) => {
      return generateQuery(ctx, schema, {
        ...args,
        where: args.where?.map((w) => {
          if (w === inWhere) {
            return { ...w, operator: "eq", value };
          }
          return w;
        }),
      });
    });
    // Every stream uses the same index, ordered by its fields after the
    // equality ones, e.g. expiresAt then _creationTime for userId_expiresAt.
    // The merge has to follow that order.
    const { index: streamIndex, values: streamValues } =
      findIndex(schema, {
        ...args,
        where: args.where
          ?.filter((w) => !isEqNull(w))
          .map((w) =>
            w === inWhere ? { ...w, operator: "eq" as const, value: "" } : w
          ),
      }) ?? {};
    const orderFields =
      streamIndex && streamIndex.indexDescriptor !== "by_creation_time"
        ? streamIndex.fields.slice(streamValues?.eq.length ?? 0)
        : ["_creationTime"];
    const result = await mergedStream(streams, orderFields).paginate(
      paginationOpts
    );
    return {
      ...result,
      page: result.page.map((doc) => selectFields(doc, args.select)),
    };
  }

  if (await sortsInMemory()) {
    return await sortInMemory();
  }
  const query = generateQuery(ctx, schema, args);
  const result = await query.paginate(paginationOpts);
  return {
    ...result,
    page: result.page.map((doc) => selectFields(doc, args.select)),
  };
};

export const listOne = async <
  Doc extends DocumentByName<GenericDataModel, T>,
  T extends TableNamesInDataModel<GenericDataModel>,
>(
  ctx: GenericQueryCtx<GenericDataModel>,
  schema: SchemaDefinition<any, any>,
  betterAuthSchema: BetterAuthDBSchema,
  args: Infer<typeof adapterArgsValidator>
): Promise<Doc | null> => {
  // Each page reads at most 200 rows. Without an index, a page can end before
  // the matching row, so keep reading until a row matches or the table ends.
  // Returning null after the first page would report an existing row as
  // missing, and Better Auth would create a duplicate.
  let cursor: string | null = null;
  for (;;) {
    const result: PaginationResult<Doc> = await paginate(
      ctx,
      schema,
      betterAuthSchema,
      {
        ...args,
        paginationOpts: { numItems: 1, cursor },
      }
    );
    if (result.page.length > 0) {
      return result.page[0] as Doc;
    }
    if (result.isDone || result.continueCursor === cursor) {
      return null;
    }
    cursor = result.continueCursor;
  }
};
