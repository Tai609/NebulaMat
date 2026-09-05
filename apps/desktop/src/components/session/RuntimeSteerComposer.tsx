import { useState, type KeyboardEvent } from "react";
import { Check, Loader2, SendHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

export function RuntimeSteerComposer({
  onSend,
}: {
  onSend: (text: string) => Promise<boolean>;
}) {
  const { t } = useTranslation("session");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const submit = async () => {
    const value = text.trim();
    if (!value || state === "sending") return;
    setState("sending");
    const accepted = await onSend(value);
    if (accepted) {
      setText("");
      setState("sent");
      window.setTimeout(() => setState("idle"), 1800);
    } else {
      setState("error");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <section className="mx-4 mb-2 rounded-input border border-accent/30 bg-accent/5 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-accent">{t("live.steering.title")}</span>
        <span className="text-[10px] text-muted">{t("live.steering.nextStep")}</span>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (state === "error") setState("idle");
          }}
          onKeyDown={onKeyDown}
          rows={1}
          className="min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-xs text-text outline-none placeholder:text-muted"
          placeholder={t("live.steering.placeholder")}
          aria-label={t("live.steering.placeholder")}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!text.trim() || state === "sending"}
          className={cn("rounded p-1.5 text-accent hover:bg-accent/10 disabled:opacity-35", state === "sent" && "text-emerald-600")}
          aria-label={t("live.steering.send")}
          title={t("live.steering.send")}
        >
          {state === "sending" ? <Loader2 size={14} className="animate-spin" /> : state === "sent" ? <Check size={14} /> : <SendHorizontal size={14} />}
        </button>
      </div>
      <div aria-live="polite" className="mt-1 min-h-3 text-[10px] text-muted">
        {state === "sent" && t("live.steering.sent")}
        {state === "error" && t("live.steering.error")}
      </div>
    </section>
  );
}
