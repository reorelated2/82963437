export function parseMoneyToken(token: string): number | null {
  const cleaned = token.replace(/\$/g, '').replace(/,/g, '').trim();
  const match = cleaned.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
  if (!match) return null;
  let amount = Number(match[1]);
  const suffix = match[2]?.toLowerCase();
  if (suffix === 'k') amount *= 1000;
  if (suffix === 'm') amount *= 1_000_000;
  if (!Number.isFinite(amount)) return null;
  if (amount < 1000 && !suffix) return null;
  return Math.round(amount);
}

export function formatMoney(amount: number): string {
  if (amount >= 1_000_000) {
    const millions = amount / 1_000_000;
    const text = Number.isInteger(millions) ? String(millions) : trimNumber(millions);
    return `$${text}M`;
  }
  if (amount >= 1000) {
    const thousands = amount / 1000;
    const text = Number.isInteger(thousands) ? String(thousands) : trimNumber(thousands);
    return `$${text}K`;
  }
  return `$${amount}`;
}

function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100).replace(/\.0$/, '');
}

export function formatPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

export function phoneKey(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (national.length !== 10) return null;
  return national;
}
