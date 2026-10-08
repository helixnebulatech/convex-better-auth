// @vitest-environment happy-dom
import type { Preloaded } from "convex/react";
import type { FunctionReference } from "convex/server";
import { convexToJson } from "convex/values";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { usePreloadedAuthQuery } from "./client.js";

const { convexState } = vi.hoisted(() => ({
  convexState: {
    auth: { isLoading: true, isAuthenticated: false, isRefreshing: false },
    liveResult: undefined as unknown,
  },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => convexState.auth,
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" ? undefined : convexState.liveResult,
}));

type Todo = { text: string };
type TodosQuery = FunctionReference<
  "query",
  "public",
  Record<string, never>,
  Todo[]
>;

const preloaded = {
  __type: undefined,
  _name: "todos:get",
  _argsJSON: convexToJson({}),
  _valueJSON: convexToJson([{ text: "from server" }]),
} as unknown as Preloaded<TodosQuery>;

const renderPreloadedAuthQuery = () => {
  const results: unknown[] = [];
  const hook = renderHook(() => {
    const result = usePreloadedAuthQuery(preloaded);
    results.push(result);
    return result;
  });
  return { results, rerender: () => hook.rerender(), unmount: hook.unmount };
};

describe("usePreloadedAuthQuery", () => {
  afterEach(() => {
    convexState.auth = {
      isLoading: true,
      isAuthenticated: false,
      isRefreshing: false,
    };
    convexState.liveResult = undefined;
  });

  it("is typed like useQuery: the query result or undefined", () => {
    expectTypeOf(usePreloadedAuthQuery<TodosQuery>).returns.toEqualTypeOf<
      Todo[] | undefined
    >();
  });

  it("returns undefined, not null, once auth settles as unauthenticated", () => {
    const { results, rerender, unmount } = renderPreloadedAuthQuery();
    expect(results[results.length - 1]).toEqual([{ text: "from server" }]);

    convexState.auth = {
      isLoading: false,
      isAuthenticated: false,
      isRefreshing: false,
    };
    rerender();

    expect(results[results.length - 1]).toBeUndefined();
    expect(results).not.toContain(null);
    unmount();
  });
});
