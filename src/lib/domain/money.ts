/**
 * Money handling (pure). Amounts are computed in integer minor units (paise, cents) so that sums never
 * suffer floating-point drift; the database stores DECIMAL(14,2). Convert only at the boundary.
 */

export type Minor = number;

/** Decimal-like (Prisma.Decimal, string or number) → minor units, rounding half away from zero. */
export function toMinor(value: { toString(): string } | number | string | null | undefined): Minor {
  if (value === null || value === undefined || value === "") return 0;
  const s = typeof value === "number" ? value.toFixed(4) : value.toString();
  const neg = s.trim().startsWith("-");
  const [int, frac = ""] = s.replace("-", "").split(".");
  const cents = Number(int) * 100 + Number((frac + "00").slice(0, 2));
  const roundUp = Number((frac + "000").slice(2, 3)) >= 5;
  const out = cents + (roundUp ? 1 : 0);
  return neg ? -out : out;
}

/** Minor units → decimal string for the database, e.g. 123456 → "1234.56". */
export function fromMinor(m: Minor): string {
  const neg = m < 0;
  const a = Math.abs(Math.round(m));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

export function formatMoney(m: Minor, currency = "INR", locale = "en-IN"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: 2 }).format(m / 100);
}

/** Percentage of an amount in minor units, rounded to the nearest unit. */
export function percentOf(m: Minor, percent: number): Minor {
  return Math.round((m * percent) / 100);
}

export const sum = (xs: Minor[]) => xs.reduce((a, b) => a + b, 0);
