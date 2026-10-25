// TikTok gift payloads arrive once per combo increment with a cumulative
// repeatCount, so a 100-rose combo is 100 events. Fold them into one event per
// combo and hand the browser a stable, small shape.

const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function normalizeGift(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const giftId = raw.giftId ?? raw.gift?.id ?? raw.extendedGiftInfo?.id;
  if (giftId == null) return null;
  const name =
    raw.giftName ??
    raw.gift?.name ??
    raw.giftDetails?.giftName ??
    raw.extendedGiftInfo?.name ??
    raw.extendedGiftInfo?.describe ??
    '';
  const user = raw.user || {};
  const cleanName = (v) => String(v ?? '').replace(/^@+/, '').trim();
  // Gift events from the unsigned feed expose the handle as displayId/idStr and
  // often ship nicknames with a leading @, so normalise both before they reach
  // the leaderboard.
  const uniqueId = cleanName(user.uniqueId || user.displayId || user.idStr || user.userId);
  return {
    giftId: Number(giftId),
    name: String(name),
    count: Math.max(1, num(raw.repeatCount ?? raw.comboCount, 1)),
    // v2 protos send repeatEnd as 0/1, older payloads as boolean.
    repeatEnd: raw.repeatEnd === undefined ? true : Boolean(Number(raw.repeatEnd)),
    coins: num(
      raw.gift?.diamondCount ??
        raw.giftDetails?.diamondCount ??
        raw.extendedGiftInfo?.diamond_count ??
        raw.extendedGiftInfo?.diamondCount ??
        raw.diamondCount
    ),
    user: {
      uniqueId,
      nickname: cleanName(user.nickname) || uniqueId,
    },
  };
}

// One folder per connection. push() returns a gift only when the combo ends,
// carrying the cumulative count the final event already reports.
export function createComboFolder() {
  return {
    push(raw) {
      const gift = normalizeGift(raw);
      if (!gift || !gift.repeatEnd) return null;
      return {
        t: 'gift',
        giftId: gift.giftId,
        name: gift.name,
        count: gift.count,
        coins: gift.coins,
        user: gift.user,
      };
    },
  };
}

export function normalizeCatalog(rawGifts) {
  if (!Array.isArray(rawGifts)) return [];
  return rawGifts
    .map((g) => ({
      id: Number(g?.id ?? g?.giftId),
      name: String(g?.name ?? g?.describe ?? ''),
      coins: num(g?.diamond_count ?? g?.diamondCount ?? g?.coins),
    }))
    .filter((g) => Number.isFinite(g.id) && g.name);
}
