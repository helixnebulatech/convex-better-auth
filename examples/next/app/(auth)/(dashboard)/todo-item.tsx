"use client";

import { Button } from "@/components/ui/button";
import { Check, Trash2, X } from "lucide-react";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { isPlaceholder } from "./mutations";

export const TodoItem = ({
  todo,
  onToggleCompleted,
  onRemove,
}: {
  todo: Doc<"todos">;
  onToggleCompleted: ({ id }: { id: Id<"todos"> }) => void;
  onRemove: ({ id }: { id: Id<"todos"> }) => void;
}) => {
  return (
    <li
      className="group flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900/50 p-3 transition-colors hover:bg-neutral-900"
      key={todo._id}
    >
      <Button
        variant="ghost"
        size="icon"
        className="cursor-pointer text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
        disabled={isPlaceholder(todo._id)}
        onClick={() => onToggleCompleted({ id: todo._id })}
      >
        {todo.completed ? (
          <Check size={16} className="text-green-500" />
        ) : (
          <X size={16} />
        )}
      </Button>

      <span
        className={
          todo.completed
            ? "flex-1 text-neutral-500 line-through"
            : "flex-1 text-neutral-100"
        }
      >
        {todo.text}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={isPlaceholder(todo._id)}
        onClick={() => onRemove({ id: todo._id })}
        className="cursor-pointer text-neutral-500 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-800 hover:text-red-400"
      >
        <Trash2 size={16} />
      </Button>
    </li>
  );
};
