export function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length ? text : null;
}

export function cleanNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

export function positiveNumber(value: unknown): number | null {
  const n = cleanNumber(value);
  if (n === null || n <= 0) return null;
  return n;
}

export function nonNegativeNumber(value: unknown): number | null {
  const n = cleanNumber(value);
  if (n === null || n < 0) return null;
  return n;
}

export function blank(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : "Data needed";
}

export function validDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}
