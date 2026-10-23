// Validates the fill order the AI follows: a Hamiltonian cycle whose traversal
// is concentric rings. Run with `node scripts/ring-cycle.mjs`.
import { pathToFileURL } from 'node:url';
import { fillOrder } from '../src/logic.js';

const ring = (x, y, w, h) => Math.min(x, y, w - 1 - x, h - 1 - y);

export function validateOrder(w, h, cells) {
  if (!cells) return { ok: false, reason: 'no order for this size' };
  const n = w * h;
  if (cells.length !== n) return { ok: false, reason: `length ${cells.length} != ${n}` };

  const seen = new Set();
  for (const c of cells) {
    const k = `${c.x},${c.y}`;
    if (c.x < 0 || c.y < 0 || c.x >= w || c.y >= h) return { ok: false, reason: `cell ${k} out of bounds` };
    if (seen.has(k)) return { ok: false, reason: `cell ${k} repeats` };
    seen.add(k);
  }

  for (let i = 0; i < n; i++) {
    const a = cells[i];
    const b = cells[(i + 1) % n];
    const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (d !== 1) return { ok: false, reason: `step ${i} -> ${(i + 1) % n} distance ${d}` };
  }

  const rings = cells.map((c) => ring(c.x, c.y, w, h));
  let peak = 0;
  for (let i = 1; i < n; i++) if (rings[i] >= rings[peak]) peak = i;
  const up = rings.slice(0, peak + 1).every((r, i, a) => i === 0 || r >= a[i - 1]);
  const down = rings.slice(peak).every((r, i, a) => i === 0 || r <= a[i - 1]);
  return { ok: true, rings, peak, monotone: up && down, maxRing: Math.max(...rings) };
}

function run(w, h) {
  const order = fillOrder(w, h);
  const result = validateOrder(w, h, order && order.cells);
  console.log(`${w}x${h}: ${result.ok ? 'valid' : 'INVALID'} ${result.reason || ''}`.trim());
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log(`  monotone rings: ${result.monotone} (peak at ${result.peak}, max ring ${result.maxRing})`);

  const grid = Array.from({ length: h }, () => Array(w).fill('  '));
  order.cells.forEach((c, i) => {
    grid[c.y][c.x] = String(i % 100).padStart(2, '0');
  });
  console.log(grid.map((r) => '  ' + r.join(' ')).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(12, 13);
}
