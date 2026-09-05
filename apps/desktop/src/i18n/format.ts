import i18n from "./index";

/** Format a number in the active UI locale. */
export function formatNumber(n: number, opts?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(i18n.language, opts).format(n);
}

/** Format a date/timestamp in the active UI locale.
 *  Accepts a Date or a millisecond epoch. */
export function formatDate(value: Date | number, opts?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(i18n.language, opts).format(value);
}
