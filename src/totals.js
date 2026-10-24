// Session totals survive reloads, so stored values are untrusted: anything that
// is not a finite number loads as a zero instead of poisoning the header.
function cleanOne(value) {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function normaliseTotals(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return { apples: cleanOne(src.apples), bombs: cleanOne(src.bombs) };
}

export function bumpTotals(totals, field, n = 1) {
  const next = (Number.isFinite(totals[field]) ? totals[field] : 0) + n;
  totals[field] = Math.max(0, Math.round(Number.isFinite(next) ? next : 0));
}
