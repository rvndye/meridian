/**
 * Fixed category → color assignment (color follows the entity, never its
 * rank — a category keeps its hue across every view and filter).
 * The most frequently-large categories hold distinct categorical slots.
 * Everything else folds to neutral gray; "Other" is always gray.
 */
export const SERIES = {
  blue: "#2a78d6",
  orange: "#eb6834",
  aqua: "#1baf7a",
  yellow: "#eda100",
  magenta: "#e87ba4",
  green: "#008300",
  violet: "#4a3aa7",
  red: "#e34948",
  gray: "#a3a19a",
} as const;

export const CATEGORY_COLORS: Record<string, string> = {
  housing: SERIES.blue,
  restaurants: SERIES.orange,
  groceries: SERIES.aqua,
  transportation: SERIES.yellow,
  shopping: SERIES.magenta,
  utilities: SERIES.green,
  travel: SERIES.violet,
  subscriptions: SERIES.red,
  entertainment: SERIES.green,
  healthcare: SERIES.gray,
  insurance: SERIES.gray,
  education: SERIES.gray,
  personal: SERIES.gray,
  fees: SERIES.gray,
  other: SERIES.gray,
  // income sources
  salary: SERIES.blue,
  bonus: SERIES.violet,
  interest: SERIES.aqua,
  dividends: SERIES.orange,
  refunds: SERIES.magenta,
  other_income: SERIES.gray,
};

export function categoryColor(id: string): string {
  return CATEGORY_COLORS[id] ?? SERIES.gray;
}

/** Semantic colors */
export const INCOME_COLOR = SERIES.aqua;
export const SPENDING_COLOR = SERIES.blue;
export const NEG_COLOR = SERIES.red;
