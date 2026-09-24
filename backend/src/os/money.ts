export function formatMoney(amount: number): string {
  const n = Math.abs(amount);
  if (n >= 1_000_000) {
    const millions = n / 1_000_000;
    const text = Number.isInteger(millions) ? String(millions) : trimNumber(millions);
    return `$${text}M`;
  }
  if (n >= 10_000) {
    const thousands = n / 1000;
    const text = Number.isInteger(thousands) ? String(thousands) : trimNumber(thousands);
    return `$${text}K`;
  }
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function parseBudget(value: string): { cents: number; label: string } | null {
  const match = value.replace(/,/g, "").match(/\$?\s*(\d+(?:\.\d+)?)\s*([kKmM])?/);
  if (!match) return null;
  let amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "k") amount *= 1000;
  else if (unit === "m") amount *= 1_000_000;
  else if (amount < 1000) amount *= 1000;
  if (amount < 1000 || amount > 100_000_000) return null;
  return { cents: Math.round(amount * 100), label: formatMoney(amount) };
}

/** Client texts stay free of em dashes, en dashes, and spaced hyphens. */
export function clientCopy(value: string): string {
  return value
    .replace(/[—–]/g, ", ")
    .replace(/\s+-\s+/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?])/g, "$1")
    .trim();
}
