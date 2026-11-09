"use client";

import { api } from "@/convex/_generated/api";
import type { Preloaded } from "convex/react";
import { useConvex, useMutation } from "convex/react";
import { usePreloadedAuthQuery } from "@convex-dev/better-auth/nextjs/client";
import { useToggleCompleted, useRemoveTodo } from "./mutations";
import { TodoItem } from "./todo-item";
import { TodoForm } from "./todo-form";

export const TodoList = ({
  preloadedTodosQuery,
}: {
  preloadedTodosQuery: Preloaded<typeof api.todos.get>;
}) => {
  const convex = useConvex();
  console.log("convex", convex);
  const mutation = useMutation(api.todos.toggle);
  console.log("mutation", mutation);
  const toggleCompleted = useToggleCompleted();
  const removeTodo = useRemoveTodo();
  const todos = usePreloadedAuthQuery(preloadedTodosQuery);

  return (
    <main>
      <div className="mx-auto max-w-2xl space-y-6">
        <TodoForm />

        <ul className="space-y-3">
          {todos?.map((todo) => (
            <TodoItem
              key={todo._id}
              todo={todo}
              onToggleCompleted={toggleCompleted}
              onRemove={removeTodo}
            />
          ))}
        </ul>

        {todos?.length === 0 && (
          <p className="py-8 text-center text-neutral-500">
            No todos yet. Add one above!
          </p>
        )}
      </div>
    </main>
  );
};
