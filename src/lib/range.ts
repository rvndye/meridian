import { addMonths, lastMonths, monthRange } from "./domain/analytics";

export interface Period {
  /** Inclusive ISO date bounds */
  start: string;
  end: string;
  /** Whole months covered, oldest first (YYYY-MM) */
  months: string[];
  /** The equal-length period immediately before */
  prevStart: string;
  prevEnd: string;
  label: string;
  rangeKey: string;
}

const PRESETS: Record<string, { n: number; label: string }> = {
  "1m": { n: 1, label: "This month" },
  "3m": { n: 3, label: "Last 3 months" },
  "6m": { n: 6, label: "Last 6 months" },
  "12m": { n: 12, label: "Last 12 months" },
};

/**
 * Resolve a range from URL search params.
 * Presets cover the last N calendar months including the current
 * month-to-date. Custom: ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD.
 */
export function resolvePeriod(
  today: string,
  params: { range?: string; from?: string; to?: string },
  fallback = "1m",
): Period {
  const key = params.range ?? fallback;
  const ym = today.slice(0, 7);

  if (key === "custom" && params.from && params.to && params.from <= params.to) {
    const start = params.from;
    const end = params.to;
    const months: string[] = [];
    for (
      let m = start.slice(0, 7);
      m <= end.slice(0, 7);
      m = addMonths(m, 1)
    ) {
      months.push(m);
    }
    const spanDays =
      Math.round(
        (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000,
      ) + 1;
    const prevEndDate = new Date(new Date(start).getTime() - 86_400_000);
    const prevStartDate = new Date(
      prevEndDate.getTime() - (spanDays - 1) * 86_400_000,
    );
    return {
      start,
      end,
      months,
      prevStart: prevStartDate.toISOString().slice(0, 10),
      prevEnd: prevEndDate.toISOString().slice(0, 10),
      label: "Custom range",
      rangeKey: "custom",
    };
  }

  const preset = PRESETS[key] ?? PRESETS[fallback];
  const months = lastMonths(ym, preset.n);
  const start = monthRange(months[0]).start;
  const end = today;
  const prevMonths = lastMonths(addMonths(months[0], -1), preset.n);
  return {
    start,
    end,
    months,
    prevStart: monthRange(prevMonths[0]).start,
    prevEnd: monthRange(prevMonths[prevMonths.length - 1]).end,
    label: preset.label,
    rangeKey: key in PRESETS ? key : fallback,
  };
}
