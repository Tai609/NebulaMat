import type { ReactNode } from "react";
import { HardDrive, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

/**
 * Plain-language disclosure of what stays local vs. what is sent to the model
 * provider (P0-2 / P2-3). Every statement here must stay true to the actual
 * architecture — when behavior changes, change this copy in the same commit.
 */
export function DataFlowCard({ model, workspace }: { model: string | null; workspace: string | null }) {
  const { t } = useTranslation(["settings", "common"]);
  /* eslint-disable i18next/no-literal-string -- `tone` is an internal enum for the dot color, not display text */
  return (
    <Section title={t("dataFlow.title")} hint={t("dataFlow.subtitle")}>
      <div className="grid gap-x-6 py-1 sm:grid-cols-2">
        <div className="sm:pr-6">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-ok/15 text-ok">
              <HardDrive size={15} />
            </span>
            <span className="text-[13px] font-semibold text-text">{t("dataFlow.local.heading")}</span>
          </div>
          <Item tone="ok">
            {t("dataFlow.local.workspaceFiles")}
            {workspace && <span className="font-mono text-[11px]"> ({workspace})</span>}.
          </Item>
          <Item tone="ok">{t("dataFlow.local.codeExecution")}</Item>
          <Item tone="ok">{t("dataFlow.local.sessionHistory")}</Item>
          <Item tone="ok">{t("dataFlow.local.providerKeys")}</Item>
        </div>
        <div className="mt-5 border-t border-faint pt-4 sm:mt-0 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-warn/15 text-warn">
              <Send size={15} />
            </span>
            <span className="text-[13px] font-semibold text-text">{t("dataFlow.remote.heading")}</span>
          </div>
          <div className="mb-1 mt-1.5">
            <span className="inline-block max-w-full break-all rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
              {model ?? t("dataFlow.remote.noModel")}
            </span>
          </div>
          <Item tone="warn">{t("dataFlow.remote.messages")}</Item>
          <Item tone="warn">{t("dataFlow.remote.notBackground")}</Item>
          <Item tone="warn">{t("dataFlow.remote.providerPolicy")}</Item>
          <Item tone="muted">{t("dataFlow.skillsHint")}</Item>
        </div>
      </div>
    </Section>
  );
  /* eslint-enable i18next/no-literal-string */
}

/** One data-flow line: a semantic dot + text, hairline-separated from its sibling. */
function Item({ tone, children }: { tone: "ok" | "warn" | "muted"; children: ReactNode }) {
  return (
    <div className="flex gap-2.5 py-2.5 text-[12.5px] leading-relaxed text-muted [&+&]:border-t [&+&]:border-faint">
      <span
        className={cn(
          "mt-[7px] h-[5px] w-[5px] shrink-0 rounded-full",
          tone === "ok" ? "bg-ok" : tone === "warn" ? "bg-warn" : "bg-muted",
        )}
      />
      <span>{children}</span>
    </div>
  );
}
