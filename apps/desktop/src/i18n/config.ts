export type Direction = "ltr" | "rtl";

export interface LocaleMeta {
  /** BCP-47 tag; also the i18next language key. */
  code: string;
  /** English name — for developer reference, never shown to users. */
  label: string;
  /** Endonym shown in the language switcher. */
  nativeName: string;
  dir: Direction;
  /** false = registered (direction/keys known) but not yet selectable. */
  shipped: boolean;
}

export const DEFAULT_LOCALE = "en";

/** localStorage key holding the user's chosen locale. */
export const LOCALE_KEY = "ai4s.locale";

/** Registration order is the switcher's display order. */
export const LOCALES: LocaleMeta[] = [
  { code: "en", label: "English", nativeName: "English", dir: "ltr", shipped: true },
  { code: "zh-Hans", label: "Simplified Chinese", nativeName: "简体中文", dir: "ltr", shipped: true },
  { code: "ja", label: "Japanese", nativeName: "日本語", dir: "ltr", shipped: true },
  { code: "es", label: "Spanish", nativeName: "Español", dir: "ltr", shipped: true },
  { code: "de", label: "German", nativeName: "Deutsch", dir: "ltr", shipped: true },
  { code: "fr", label: "French", nativeName: "Français", dir: "ltr", shipped: true },
  { code: "ko", label: "Korean", nativeName: "한국어", dir: "ltr", shipped: true },
  { code: "pt-BR", label: "Portuguese (Brazil)", nativeName: "Português (Brasil)", dir: "ltr", shipped: false },
  { code: "ar", label: "Arabic", nativeName: "العربية", dir: "rtl", shipped: false },
];

export function shippedLocales(): LocaleMeta[] {
  return LOCALES.filter((l) => l.shipped);
}

export function localeMeta(code: string): LocaleMeta | undefined {
  return LOCALES.find((l) => l.code === code);
}

/** Map an arbitrary BCP-47 tag to the nearest SHIPPED locale:
 *  exact (case-insensitive) → same base language → DEFAULT_LOCALE.
 *  Unshipped locales are never a resolution target. */
export function resolveLocale(candidate: string | null | undefined): string {
  if (!candidate) return DEFAULT_LOCALE;
  const shipped = shippedLocales();
  const want = candidate.toLowerCase();
  const exact = shipped.find((l) => l.code.toLowerCase() === want);
  if (exact) return exact.code;
  const base = want.split("-")[0];
  const byBase = shipped.find((l) => l.code.toLowerCase().split("-")[0] === base);
  return byBase ? byBase.code : DEFAULT_LOCALE;
}

/** First-run guess when no preference is stored: saved value → OS/browser
 *  language → default. Persistence is owned by the store; this only seeds it. */
export function detectInitialLocale(): string {
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved) return resolveLocale(saved);
  const nav = typeof navigator !== "undefined" ? navigator.language : null;
  return resolveLocale(nav);
}
