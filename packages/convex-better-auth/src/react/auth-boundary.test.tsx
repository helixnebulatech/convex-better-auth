// @vitest-environment happy-dom
import type { PropsWithChildren } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import type { EmptyObject } from "convex-helpers";
import { AuthBoundary } from "./index.js";
import type { AuthClient } from "./index.js";

const { convexAuth } = vi.hoisted(() => ({
  convexAuth: { current: { isLoading: true, isAuthenticated: false } },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => convexAuth.current,
  Authenticated: ({ children }: PropsWithChildren) =>
    convexAuth.current.isAuthenticated ? children : null,
  useQuery: () => undefined,
  ConvexProviderWithAuth: ({ children }: PropsWithChildren) => children,
}));

const getAuthUserFn = {} as FunctionReference<"query", "public", EmptyObject>;

const setup = () => {
  const getSession = vi.fn(async () => ({ data: null }));
  const authClient = { getSession } as unknown as AuthClient;
  const tree = (onUnauth: () => void) => (
    <AuthBoundary
      authClient={authClient}
      onUnauth={onUnauth}
      getAuthUserFn={getAuthUserFn}
      isAuthError={() => false}
    >
      <div />
    </AuthBoundary>
  );
  return { getSession, tree };
};

describe("AuthBoundary", () => {
  beforeEach(() => {
    convexAuth.current = { isLoading: true, isAuthenticated: false };
  });

  it("calls onUnauth once when re-rendered with a new inline onUnauth", async () => {
    const { getSession, tree } = setup();
    const onUnauth = vi.fn();
    convexAuth.current = { isLoading: false, isAuthenticated: false };
    const { rerender } = render(tree(() => onUnauth()));
    await act(async () => {});
    for (let i = 0; i < 3; i++) {
      rerender(tree(() => onUnauth()));
      await act(async () => {});
    }
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onUnauth once auth settles as unauthenticated", async () => {
    const { getSession, tree } = setup();
    const first = vi.fn();
    const latest = vi.fn();
    const { rerender } = render(tree(first));
    await act(async () => {});
    rerender(tree(latest));
    await act(async () => {});
    expect(getSession).not.toHaveBeenCalled();

    convexAuth.current = { isLoading: false, isAuthenticated: false };
    rerender(tree(latest));
    await act(async () => {});
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  it("does not call onUnauth while authenticated", async () => {
    const { getSession, tree } = setup();
    const onUnauth = vi.fn();
    convexAuth.current = { isLoading: false, isAuthenticated: true };
    render(tree(onUnauth));
    await act(async () => {});
    expect(getSession).not.toHaveBeenCalled();
    expect(onUnauth).not.toHaveBeenCalled();
  });
});
