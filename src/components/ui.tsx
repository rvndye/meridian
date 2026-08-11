import clsx from "clsx";
import { fmtSigned, fmtPercent } from "@/lib/format";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  subtitle,
  actions,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-lg border border-border bg-surface p-5",
        className,
      )}
    >
      {(title || actions) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && (
              <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p>
            )}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * Signed change chip. `upIsGood` controls color semantics: net worth up =
 * green; spending up = red.
 */
export function Delta({
  value,
  pct,
  upIsGood = true,
  suffix,
}: {
  value: number;
  pct?: number | null;
  upIsGood?: boolean;
  suffix?: string;
}) {
  const good = upIsGood ? value >= 0 : value <= 0;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[12px] font-medium tnum",
        good ? "text-pos" : "text-neg",
      )}
    >
      {fmtSigned(value)}
      {pct !== undefined && pct !== null && (
        <span className="text-ink-3">({fmtPercent(Math.abs(pct))})</span>
      )}
      {suffix && <span className="font-normal text-ink-3">{suffix}</span>}
    </span>
  );
}

export function StatCard({
  label,
  value,
  delta,
  upIsGood,
  deltaSuffix,
  children,
}: {
  label: string;
  value: string;
  delta?: number;
  upIsGood?: boolean;
  deltaSuffix?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-1">
      <div className="text-[12px] font-medium text-ink-2">{label}</div>
      <div className="text-[22px] font-semibold tracking-tight">{value}</div>
      {delta !== undefined && (
        <Delta value={delta} upIsGood={upIsGood} suffix={deltaSuffix} />
      )}
      {children}
    </Card>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn" | "accent";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-surface-2 text-ink-2 border border-border",
        tone === "good" && "bg-pos-soft text-pos",
        tone === "bad" && "bg-neg-soft text-neg",
        tone === "warn" && "bg-[#fdf6e3] text-[#9a6b00]",
        tone === "accent" && "bg-accent-soft text-accent",
      )}
    >
      {children}
    </span>
  );
}

/** Money amount with sign semantics: inflows green, outflows plain ink. */
export function Amount({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const inflow = value < 0;
  return (
    <span
      className={clsx(
        "tnum font-medium",
        inflow ? "text-pos" : "text-ink",
        className,
      )}
    >
      {inflow ? "+" : ""}
      {new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Math.abs(value))}
    </span>
  );
}

export function CategoryDot({ colorVar }: { colorVar: string }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ background: colorVar }}
    />
  );
}
