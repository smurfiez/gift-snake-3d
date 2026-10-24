import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseTotals, bumpTotals } from '../src/totals.js';

test('normaliseTotals fills missing fields with zeros', () => {
  assert.deepEqual(normaliseTotals({}), { apples: 0, bombs: 0 });
});

test('normaliseTotals survives a null payload', () => {
  assert.deepEqual(normaliseTotals(null), { apples: 0, bombs: 0 });
});

test('normaliseTotals reads numeric strings and clamps negatives', () => {
  assert.deepEqual(normaliseTotals({ apples: '12', bombs: -4 }), { apples: 12, bombs: 0 });
});

test('normaliseTotals rejects infinite values and rounds fractions', () => {
  assert.deepEqual(normaliseTotals({ apples: Infinity, bombs: 3.7 }), { apples: 0, bombs: 4 });
});

test('bumpTotals adds to the requested field', () => {
  const totals = { apples: 1, bombs: 0 };
  bumpTotals(totals, 'apples', 3);
  assert.equal(totals.apples, 4);
});

test('bumpTotals clamps at zero', () => {
  const totals = { apples: 2, bombs: 1 };
  bumpTotals(totals, 'bombs', -5);
  assert.equal(totals.bombs, 0);
});
