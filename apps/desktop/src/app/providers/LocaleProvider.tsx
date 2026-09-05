import { useEffect, type ReactNode } from "react";
import { useUiStore } from "@/lib/store";
import { localeMeta } from "@/i18n/config";
import i18n from "@/i18n";

/** Syncs the store's locale into i18next and onto the document root.
 *  Direction is set once here from the locale registry — components must never
 *  hardcode direction (see the i18n design doc, §7 RTL readiness). */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useUiStore((s) => s.locale);
  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
    document.documentElement.dir = localeMeta(locale)?.dir ?? "ltr";
  }, [locale]);
  return <>{children}</>;
}
