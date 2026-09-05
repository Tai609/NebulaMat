import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export interface ConversationQuestion {
  blockIndex: number;
  text: string;
}

function compactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A compact transcript map: every user turn receives a marker that keeps its
 * relative place in the conversation. The reader can preview a turn on hover
 * and return to it without opening a separate panel.
 */
export function QuestionRail({
  questions,
  chatRef,
  contentRef,
  className,
  style,
}: {
  questions: ConversationQuestion[];
  chatRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  className?: string;
  style?: CSSProperties;
}) {
  const { t } = useTranslation("session");
  const [positions, setPositions] = useState<Record<number, number>>({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const questionKey = questions.map((question) => question.blockIndex).join(",");

  useEffect(() => {
    const scroller = chatRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    const anchorFor = (blockIndex: number) =>
      content.querySelector<HTMLElement>(`[data-question-anchor="${blockIndex}"]`);

    const update = () => {
      const contentHeight = Math.max(content.scrollHeight, 1);
      const nextPositions: Record<number, number> = {};
      for (const [questionNumber, question] of questions.entries()) {
        const anchor = anchorFor(question.blockIndex);
        // Fall back to evenly-spaced markers before layout is measurable.
        nextPositions[question.blockIndex] = anchor
          ? Math.min(0.98, Math.max(0.02, anchor.offsetTop / contentHeight))
          : (questionNumber + 1) / (questions.length + 1);
      }
      setPositions((current) => {
        const changed = Object.keys(nextPositions).some(
          (key) => current[Number(key)] !== nextPositions[Number(key)],
        );
        return changed || Object.keys(current).length !== Object.keys(nextPositions).length ? nextPositions : current;
      });

      const readingLine = scroller.scrollTop + scroller.clientHeight * 0.3;
      let currentQuestion = questions[0]?.blockIndex ?? null;
      for (const question of questions) {
        const anchor = anchorFor(question.blockIndex);
        if (!anchor || anchor.offsetTop > readingLine) break;
        currentQuestion = question.blockIndex;
      }
      setActiveIndex((current) => (current === currentQuestion ? current : currentQuestion));
    };

    update();
    scroller.addEventListener("scroll", update, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => scroller.removeEventListener("scroll", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    observer.observe(content);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [chatRef, contentRef, questionKey, questions]);

  if (questions.length < 2) return null;

  const goToQuestion = (blockIndex: number) => {
    const scroller = chatRef.current;
    const content = contentRef.current;
    const anchor = content?.querySelector<HTMLElement>(`[data-question-anchor="${blockIndex}"]`);
    if (!scroller || !anchor) return;

    setActiveIndex(blockIndex);
    const top = Math.max(0, anchor.offsetTop - scroller.clientHeight * 0.22);
    scroller.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <nav
      aria-label={t("questionRail.aria")}
      className={cn("pointer-events-none absolute left-3 z-20 w-6", className)}
      style={style}
    >
      <div aria-hidden className="absolute bottom-1 top-1 left-[9px] border-l border-faint" />
      {questions.map((question, questionNumber) => {
        const preview = compactText(question.text);
        const position = positions[question.blockIndex] ?? (questionNumber + 1) / (questions.length + 1);
        const active = activeIndex === question.blockIndex;
        return (
          <button
            key={question.blockIndex}
            type="button"
            onClick={() => goToQuestion(question.blockIndex)}
            aria-label={t("questionRail.itemAria", { number: questionNumber + 1 })}
            aria-current={active ? "location" : undefined}
            className="pointer-events-auto group absolute left-0 flex h-6 w-6 -translate-y-1/2 items-center justify-start outline-none"
            style={{ top: `${position * 100}%` }}
          >
            <span
              aria-hidden
              className={cn(
                "h-0.5 w-2 rounded-full bg-border transition-[width,background-color] group-hover:w-4 group-focus-visible:w-4 group-hover:bg-accent group-focus-visible:bg-accent",
                active && "w-4 bg-accent",
              )}
            />
            <span
              role="tooltip"
              className="pointer-events-none invisible absolute left-7 top-1/2 w-[min(18rem,calc(100vw-5rem))] -translate-y-1/2 rounded-input border border-border bg-surface px-3 py-2 text-left text-xs leading-relaxed text-text opacity-0 shadow-pop transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
            >
              {preview}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
