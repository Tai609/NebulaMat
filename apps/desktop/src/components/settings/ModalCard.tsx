import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isTauri, modalStatus, type ModalStatus } from "@/lib/tauri";
import { cn } from "@/lib/cn";
import { Section } from "./Section";

/**
 * Cloud compute (Modal) status (P2-2). Like the HPC card, the app never handles
 * credentials — Modal runs use the user's own install + token. This card only
 * detects readiness; the bundled `modal-run` skill drives actual jobs.
 */
export function ModalCard() {
  const { t } = useTranslation(["settings", "common"]);
  const [status, setStatus] = useState<ModalStatus | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    if (!isTauri) return;
    setChecking(true);
    try {
      setStatus(await modalStatus());
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const ok = status?.installed && status?.authenticated;
  const dot = ok ? "bg-ok" : status?.installed ? "bg-warn" : "bg-muted";

  return (
    <Section
      title={t("modal.title")}
      hint={t("modal.subtitle")}
      action={
        isTauri ? (
          <button
            className="inline-flex items-center gap-1 rounded-input border border-transparent bg-surface-2 px-2.5 py-1 text-[12px] text-muted transition-colors hover:bg-border/50 hover:text-text"
            onClick={() => void check()}
            disabled={checking}
            title={t("modal.recheck")}
          >
            {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{" "}
            {t("modal.recheck")}
          </button>
        ) : undefined
      }
    >
      <div className="text-[13px]">
        {!isTauri ? (
          <p className="text-muted">{t("modal.unavailable")}</p>
        ) : (
          <div className="flex items-start gap-2.5">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dot)} />
            <div className="min-w-0">
              <div className="text-text">
                {ok
                  ? `${t("modal.ready")}${status?.version ? ` · ${status.version}` : ""}`
                  : status?.installed
                    ? t("modal.installedNotAuthenticated")
                    : t("modal.notInstalled")}
              </div>
              {status?.hint && <div className="mt-0.5 text-xs text-muted">{status.hint}</div>}
              {ok && (
                <div className="mt-0.5 text-xs text-muted">
                  {t("modal.readyHint.prefix")}{" "}
                  {/* eslint-disable-next-line i18next/no-literal-string -- literal CLI command name, not prose */}
                  <span className="font-mono">modal-run</span> {t("modal.readyHint.suffix")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
