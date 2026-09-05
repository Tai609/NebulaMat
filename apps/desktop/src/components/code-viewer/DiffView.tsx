import { cn } from "@/lib/cn";

/** Render a unified diff with added/removed/hunk lines colored. Shared by the
 *  live tool-call detail and the artifact History (an edit's lineage). */
export function DiffView({ diff, className }: { diff: string; className?: string }) {
  return (
    <div
      className={cn(
        "whitespace-pre-wrap break-all rounded-input bg-surface-2 px-3 py-2 font-mono text-xs leading-5",
        className,
      )}
    >
      {diff.split("\n").map((line, i) => (
        <div
          key={i}
          className={cn(
            line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")
              ? "text-muted"
              : line.startsWith("+")
                ? "text-ok"
                : line.startsWith("-")
                  ? "text-error"
                  : "text-muted",
          )}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}
