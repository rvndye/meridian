import { fmtCurrencyWhole } from "@/lib/format";

export interface HBarItem {
  key: string;
  label: string;
  value: number;
  color: string;
  sub?: string;
}

/**
 * Horizontal bar list — the workhorse for "X by category/merchant"
 * comparisons. Pure HTML, server-renderable, labels in ink tokens.
 */
export function HBarList({
  items,
  max,
}: {
  items: HBarItem[];
  max?: number;
}) {
  const top = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {items.map((item) => (
        <div key={item.key} className="grid grid-cols-[minmax(96px,1fr)_2fr_auto] items-center gap-3">
          <div className="truncate text-[13px] text-ink">
            {item.label}
            {item.sub && (
              <span className="ml-1.5 text-[11px] text-ink-3">{item.sub}</span>
            )}
          </div>
          <div className="h-4 overflow-hidden rounded-[4px] bg-surface-2">
            <div
              className="h-full rounded-[4px]"
              style={{
                width: `${Math.max((Math.abs(item.value) / top) * 100, 1)}%`,
                background: item.color,
              }}
            />
          </div>
          <div className="tnum text-right text-[13px] font-medium text-ink">
            {fmtCurrencyWhole(item.value)}
          </div>
        </div>
      ))}
      {items.length === 0 && (
        <p className="text-[13px] text-ink-3">No data for this period.</p>
      )}
    </div>
  );
}
