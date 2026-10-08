const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const moneyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const hours = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatMoney(value: number, whole = false): string {
  return (whole ? moneyWhole : money).format(value);
}

export function formatQty(value: number): string {
  return qty.format(value);
}

export function formatHours(value: number): string {
  return hours.format(value);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "No bid date";
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

export const STATUS_LABEL = {
  draft: "Draft",
  review: "In review",
  submitted: "Submitted",
} as const;
