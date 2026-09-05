export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="text-lg text-text">{title}</div>
      {hint && <div className="text-sm text-muted">{hint}</div>}
    </div>
  );
}
