import { cn } from "@/lib/cn";

/** Text-entry look: a soft filled "well" — borderless so it never reads as a
 *  box nested inside the section card; a subtle accent ring appears on focus. */
export const inputCls = (extra = "") =>
  cn(
    "h-9 rounded-input border border-transparent bg-surface-2 px-3 text-[13px] text-text outline-none",
    "placeholder:text-muted focus:border-accent/55 focus:bg-surface",
    extra,
  );

/** Full-width <select>: same well, with our own chevron (not the metallic
 *  system chrome). */
export const selectCls = (extra = "") => cn(inputCls(extra), "select-chrome");

/** Right-aligned dropdown chip: transparent at rest (reads as text + chevron,
 *  not a filled box), fills only on hover/focus. For short enum values shown on
 *  the right of a Row. */
export const chipCls = (extra = "") =>
  cn(
    "h-8 rounded-input border border-transparent bg-transparent pl-2.5 text-[13px] text-text outline-none",
    "cursor-pointer transition-colors hover:bg-surface-2 focus:bg-surface-2 focus:border-accent/45 select-chrome",
    extra,
  );
