import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGift, createComboFolder, normalizeCatalog } from '../server/normalize.mjs';

const raw = (extra = {}) => ({
  giftId: 5655,
  giftName: 'Rose',
  repeatCount: 1,
  repeatEnd: true,
  user: { uniqueId: 'nova', nickname: 'Nova' },
  ...extra,
});

test('normalizeGift reads the flat connector shape', () => {
  assert.deepEqual(normalizeGift(raw({ repeatCount: 4 })), {
    giftId: 5655,
    name: 'Rose',
    count: 4,
    repeatEnd: true,
    coins: 0,
    user: { uniqueId: 'nova', nickname: 'Nova' },
  });
});

test('normalizeGift reads the nested gift shape', () => {
  const gift = normalizeGift({
    gift: { id: 5269, name: 'Finger Heart', diamondCount: 5 },
    user: { userId: '42' },
    repeatEnd: false,
  });
  assert.equal(gift.giftId, 5269);
  assert.equal(gift.name, 'Finger Heart');
  assert.equal(gift.coins, 5);
  assert.equal(gift.user.uniqueId, '42');
  assert.equal(gift.repeatEnd, false);
});

test('normalizeGift drops payloads with no gift id', () => {
  assert.equal(normalizeGift({ giftName: 'Rose' }), null);
  assert.equal(normalizeGift(null), null);
});

test('normalizeGift reads the v2 proto shape with numeric repeatEnd', () => {
  const gift = normalizeGift({
    giftId: 5655,
    repeatCount: 2,
    repeatEnd: 0,
    giftDetails: { giftName: 'Rose', diamondCount: 1 },
    user: { uniqueId: 'nova', nickname: 'Nova' },
  });
  assert.equal(gift.name, 'Rose');
  assert.equal(gift.coins, 1);
  assert.equal(gift.repeatEnd, false);
  assert.equal(normalizeGift({ giftId: 1, repeatEnd: 1 }).repeatEnd, true);
});

test('combo folder keeps increments and flushes once at the end', () => {
  const folder = createComboFolder();
  assert.equal(folder.push(raw({ repeatCount: 1, repeatEnd: false })), null);
  assert.equal(folder.push(raw({ repeatCount: 2, repeatEnd: false })), null);
  const end = folder.push(raw({ repeatCount: 3, repeatEnd: true }));
  assert.equal(end.count, 3);
  assert.equal(end.giftId, 5655);
  assert.equal(end.user.nickname, 'Nova');
  assert.equal(folder.push(raw({ repeatCount: 3, repeatEnd: true })).count, 3);
});

test('combo folders are independent per viewer and gift', () => {
  const folder = createComboFolder();
  folder.push(raw({ repeatCount: 2, repeatEnd: false, user: { uniqueId: 'a' } }));
  folder.push(raw({ repeatCount: 5, repeatEnd: false, user: { uniqueId: 'b' } }));
  assert.equal(folder.push(raw({ repeatCount: 3, repeatEnd: true, user: { uniqueId: 'a' } })).count, 3);
  assert.equal(folder.push(raw({ repeatCount: 6, repeatEnd: true, user: { uniqueId: 'b' } })).count, 6);
});

test('unsigned gift feed resolves handle and strips leading @', () => {
  const gift = normalizeGift(
    raw({ user: { displayId: '@dreamy_devil', nickname: '@Dreamy_devil', idStr: '123' } })
  );
  assert.equal(gift.user.uniqueId, 'dreamy_devil');
  assert.equal(gift.user.nickname, 'Dreamy_devil');
});
