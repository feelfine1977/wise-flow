/**
 * Deterministic number formatting (no `Intl`, so exports render the same
 * everywhere). Locale only switches separators.
 */
export type Locale = "en" | "de";

const SEP: Record<Locale, { group: string; decimal: string }> = {
  en: { group: ",", decimal: "." },
  de: { group: ".", decimal: "," },
};

function fixed(value: number, decimals: number): string {
  const s = value.toFixed(decimals);
  return s === "-0" || /^-0\.0*$/.test(s) ? s.slice(1) : s;
}

/** Integer with grouping: 1234567 → "1,234,567" (en) / "1.234.567" (de). */
export function formatCount(value: number, locale: Locale = "en"): string {
  if (!Number.isFinite(value)) return "–";
  const sign = value < 0 ? "-" : "";
  const digits = Math.round(Math.abs(value)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, SEP[locale].group);
  return sign + grouped;
}

/** Decimal number with a fixed number of decimals. */
export function formatNumber(value: number, decimals = 1, locale: Locale = "en"): string {
  if (!Number.isFinite(value)) return "–";
  const [int, frac] = fixed(value, decimals).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, SEP[locale].group);
  return sign + grouped + (frac !== undefined ? SEP[locale].decimal + frac : "");
}

/** Share in [0, 1] as a percentage: 0.2258 → "23 %". Values under 1 % keep one decimal. */
export function formatShare(value: number, locale: Locale = "en"): string {
  if (!Number.isFinite(value)) return "–";
  const pct = value * 100;
  const decimals = Math.abs(pct) > 0 && Math.abs(pct) < 1 ? 1 : 0;
  return `${formatNumber(pct, decimals, locale)} %`;
}

/** Signed share: +0.05 → "+5 %". */
export function formatDelta(value: number, locale: Locale = "en"): string {
  if (!Number.isFinite(value)) return "–";
  const s = formatShare(Math.abs(value), locale);
  return value > 0 ? `+${s}` : value < 0 ? `−${s}` : `±${s}`;
}

/** Duration given in hours: 0.5 → "30 min", 36 → "1.5 d", 400 → "17 d". */
export function formatHours(hours: number, locale: Locale = "en"): string {
  if (!Number.isFinite(hours)) return "–";
  const abs = Math.abs(hours);
  const sign = hours < 0 ? "−" : "";
  if (abs < 1) return `${sign}${formatNumber(abs * 60, 0, locale)} min`;
  if (abs < 48) return `${sign}${formatNumber(abs, abs < 10 ? 1 : 0, locale)} h`;
  const days = abs / 24;
  return `${sign}${formatNumber(days, days < 10 ? 1 : 0, locale)} d`;
}

/** Duration given in days. */
export function formatDays(days: number, locale: Locale = "en"): string {
  return formatHours(days * 24, locale);
}

/** Compact count for badges: 1234 → "1.2k", 1234567 → "1.2M". */
export function formatCompact(value: number, locale: Locale = "en"): string {
  if (!Number.isFinite(value)) return "–";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${formatNumber(abs / 1e6, abs >= 1e7 ? 0 : 1, locale)}M`;
  if (abs >= 1e3) return `${sign}${formatNumber(abs / 1e3, abs >= 1e4 ? 0 : 1, locale)}k`;
  return formatCount(value, locale);
}
