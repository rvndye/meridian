"use client";

/**
 * Chart components. Specs follow the dataviz method: 2px lines, ≤24px bars
 * with 4px rounded data-ends, ~10% area washes, hairline grids, ink-token
 * text (never series-colored), tooltips on hover, legends for ≥2 series.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtCompact, fmtCurrency, fmtMonthShort, fmtDateShort } from "@/lib/format";
import { INCOME_COLOR, NEG_COLOR, SPENDING_COLOR, categoryColor } from "@/lib/colors";

const GRID = "#eceae5";

const tooltipStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid #e7e5e0",
  borderRadius: 8,
  fontSize: 12,
  color: "#1a1a19",
  boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
};

function moneyTip(value: number | string | (number | string)[]): string {
  return typeof value === "number" ? fmtCurrency(value) : String(value);
}

// ---------- Income vs Spending grouped bars ----------

export interface FlowDatum {
  month: string;
  income: number;
  spending: number;
  net: number;
}

export function IncomeSpendingChart({ data }: { data: FlowDatum[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer>
        <BarChart data={data} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonthShort}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtCompact}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            formatter={(v, name) => [moneyTip(v as number), name as string]}
            labelFormatter={(m) => fmtMonthShort(String(m))}
          />
          <Bar
            dataKey="income"
            name="Income"
            fill={INCOME_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
          <Bar
            dataKey="spending"
            name="Spending"
            fill={SPENDING_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
          />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-4 text-[12px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: INCOME_COLOR }} />
          Income
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: SPENDING_COLOR }} />
          Spending
        </span>
      </div>
    </div>
  );
}

// ---------- Net cash flow (diverging single series) ----------

export function NetFlowChart({ data }: { data: FlowDatum[] }) {
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonthShort}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtCompact}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            formatter={(v) => [moneyTip(v as number), "Net"]}
            labelFormatter={(m) => fmtMonthShort(String(m))}
          />
          <Bar dataKey="net" name="Net" maxBarSize={24} radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell
                key={d.month}
                fill={d.net >= 0 ? INCOME_COLOR : NEG_COLOR}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Net worth area ----------

export interface NetWorthDatum {
  date: string;
  netWorth: number;
  assets?: number;
  liabilities?: number;
}

export function NetWorthChart({
  data,
  height = 280,
}: {
  data: NetWorthDatum[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="nwFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SPENDING_COLOR} stopOpacity={0.14} />
              <stop offset="100%" stopColor={SPENDING_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateShort}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={fmtCompact}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name) => [moneyTip(v as number), name as string]}
            labelFormatter={(d) => fmtDateShort(String(d))}
          />
          <Area
            type="monotone"
            dataKey="netWorth"
            name="Net worth"
            stroke={SPENDING_COLOR}
            strokeWidth={2}
            fill="url(#nwFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Category donut (top 5 + Other) ----------

export interface DonutDatum {
  categoryId: string;
  name: string;
  amount: number;
}

export function CategoryDonut({ data }: { data: DonutDatum[] }) {
  return (
    <div className="h-52">
      <ResponsiveContainer>
        <PieChart>
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, name) => [moneyTip(v as number), name as string]}
          />
          <Pie
            data={data}
            dataKey="amount"
            nameKey="name"
            innerRadius="62%"
            outerRadius="90%"
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((d) => (
              <Cell
                key={d.categoryId}
                fill={d.categoryId === "__other" ? "#c9c7c0" : categoryColor(d.categoryId)}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Monthly single-series bars (income page, category trend) ----------

export function MonthlyBars({
  data,
  color = SPENDING_COLOR,
  name = "Amount",
}: {
  data: { month: string; amount: number }[];
  color?: string;
  name?: string;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={fmtMonthShort}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtCompact}
            axisLine={false}
            tickLine={false}
            width={52}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            formatter={(v) => [moneyTip(v as number), name]}
            labelFormatter={(m) => fmtMonthShort(String(m))}
          />
          <Bar dataKey="amount" name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Generic value history (assets, single series) ----------

export function ValueHistoryChart({
  data,
  height = 220,
}: {
  data: { date: string; value: number }[];
  height?: number;
}) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="assetFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SPENDING_COLOR} stopOpacity={0.14} />
              <stop offset="100%" stopColor={SPENDING_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDateShort}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tickFormatter={fmtCompact}
            axisLine={false}
            tickLine={false}
            width={56}
            domain={["auto", "auto"]}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [moneyTip(v as number), "Value"]}
            labelFormatter={(d) => fmtDateShort(String(d))}
          />
          <Area
            type="monotone"
            dataKey="value"
            name="Value"
            stroke={SPENDING_COLOR}
            strokeWidth={2}
            fill="url(#assetFill)"
            dot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
            activeDot={{ r: 5, strokeWidth: 2, stroke: "#fff" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------- Sparkline (stat tiles) ----------

export function Sparkline({
  data,
  color = SPENDING_COLOR,
}: {
  data: { x: string; y: number }[];
  color?: string;
}) {
  return (
    <div className="h-10">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Line
            type="monotone"
            dataKey="y"
            stroke={color}
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
