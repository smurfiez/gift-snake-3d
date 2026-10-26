// TikTok gift ids are stable per gift but differ per room/region, so effects are
// seeded by name and compiled from the bridge catalog. Once the real catalog has
// been seen, freeze those ids into GIFT_MAP and delete SEED.
const SEED = {
  'Rose': 'apple', 'Finger Heart': 'apple', 'TikTok': 'apple', 'Hand Hearts': 'apple',
  'Ice Cream Cone': 'speed', 'Doughnut': 'slow',
  'Corgi': 'bomb', 'Galaxy': 'bomb', 'Lion': 'bomb', 'Universe': 'bomb',
  'Sunglasses': 'widen', 'Cap': 'taller',
};

// id -> effect. Checked before the seed ids, so pasted real ids win.
export const GIFT_MAP = {};

// id -> { effect, count }. Checked before GIFT_MAP. Ids come from the Euler
// Stream gift list; `count` is how many items one gift puts on the board.
export const GIFT_RULES = {
  '6064': { effect: 'bomb', count: 5 },   // GG
  '5487': { effect: 'apple', count: 20 }, // Finger Heart
  '8913': { effect: 'bomb', count: 20 },  // Rosa
  '5879': { effect: 'bomb', count: 50 },  // Doughnut
  '5659': { effect: 'taller', count: 1 }, // Paper Crane — grows the board upwards
  '10802': { effect: 'widen', count: 1 }, // Heart Me Flex — grows the board sideways
};

// A gift with no rule of its own still feeds the snake five apples.
const APPLES_PER_GIFT = { apple: 5 };

const EFFECTS = new Set(['apple', 'bomb', 'speed', 'slow', 'widen', 'taller']);

const UNKNOWN_LIMIT = 20;
const RETRY_MS = 3000;
const SEED_BY_NAME = new Map(Object.entries(SEED).map(([name, effect]) => [name.toLowerCase(), effect]));
const normaliseName = (name) => String(name ?? '').trim().toLowerCase();

export function createTikTokFeed({ onGift, onStatus, url = 'ws://127.0.0.1:9090' } = {}) {
  let enabled = false, socket = null, retryTimer = null, bridgeState = null, bridgeDetail = '';
  let seedById = new Map(), ignored = 0, unknowns = [];
  let bridgeRules = new Map(); // gift id -> { effect, count }, owned by the bridge panel
  let bridgeRoom = ''; // handle the bridge is joined to, shown in the debug menu
  let reported = { state: null, ignored: -1 }; // last pair pushed to onStatus

  // The bridge's own state wins while it is talking; otherwise the socket decides.
  const state = () => (!enabled ? 'off' : !socket ? 'offline' : socket.readyState !== 1 ? 'connecting' : bridgeState || 'live');

  function report() {
    const next = state();
    if (next === 'offline' && reported.state !== 'offline') {
      console.warn(`[tiktok] bridge unreachable at ${url}, retrying every ${RETRY_MS / 1000}s`);
    }
    if (next === reported.state && ignored === reported.ignored) return;
    reported = { state: next, ignored };
    if (typeof onStatus !== 'function') return;
    if (bridgeDetail && next === bridgeState) onStatus({ state: next, ignored, detail: bridgeDetail });
    else onStatus({ state: next, ignored });
  }

  function stopRetry() { if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null; } }

  function scheduleRetry() {
    if (!enabled || retryTimer !== null) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, RETRY_MS);
  }

  function connect() {
    if (!enabled || socket) return;
    stopRetry();
    let ws;
    try { ws = new WebSocket(url); } catch { scheduleRetry(); report(); return; }
    socket = ws;
    ws.onopen = () => { if (socket !== ws) return; bridgeState = null; bridgeDetail = ''; report(); };
    ws.onmessage = (event) => { if (socket === ws) handle(event.data); };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null; bridgeState = null; bridgeDetail = '';
      scheduleRetry();
      report();
    };
    ws.onerror = () => {}; // close follows and schedules the retry
    report();
  }

  function applyCatalog(gifts) {
    if (!Array.isArray(gifts)) return;
    const next = new Map();
    for (const gift of gifts) {
      if (!gift || gift.id === undefined || gift.id === null) continue;
      const effect = SEED_BY_NAME.get(normaliseName(gift.name));
      if (effect) next.set(String(gift.id), effect);
    }
    seedById = next;
  }

  // The bridge's panel table wins over every baked-in table, so saving there
  // retunes the game without a reload.
  function applyRules(rules) {
    const next = new Map();
    if (!rules || typeof rules !== 'object') { bridgeRules = next; return; }
    for (const [id, rule] of Object.entries(rules)) {
      if (!rule || !EFFECTS.has(rule.effect)) continue;
      const raw = Number(rule.count);
      // A rule without a count keeps the effect's own default, exactly like a
      // gift that only declares an effect.
      const count = Number.isFinite(raw) ? Math.max(1, Math.min(999, Math.round(raw))) : undefined;
      next.set(String(id), { effect: rule.effect, count });
    }
    bridgeRules = next;
  }

  // The debug menu drives the bridge through the same socket the gifts arrive on,
  // so no extra port or CORS rule is needed. An empty room keeps the current one.
  function reconnect(room) {
    if (!socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify({ t: 'reconnect', user: String(room ?? '').trim() }));
    } catch {
      return false;
    }
    return true;
  }

  function applyGift(msg) {
    const key = String(msg.giftId);
    const rule = bridgeRules.get(key) ?? GIFT_RULES[key];
    const effect = rule?.effect ?? GIFT_MAP[key] ?? seedById.get(key);
    if (!effect) {
      ignored += 1;
      unknowns.push({ giftId: msg.giftId, name: msg.name ?? '' });
      if (unknowns.length > UNKNOWN_LIMIT) unknowns.shift();
      report();
      return;
    }
    const user = msg.user || {};
    const perGift = rule?.count ?? APPLES_PER_GIFT[effect] ?? 1;
    // Handles are stable and unique; the display nickname can repeat or contain
    // spaces, which breaks the @mention look in toasts and the leaderboard.
    // A gift combo still pays out once: the count is the gift's item count, not
    // the number of taps in the combo.
    if (typeof onGift === 'function') onGift(effect, user.uniqueId || user.nickname || 'viewer', perGift);
  }

  // Comments, likes, joins, follows and shares take the gift route once the
  // panel maps their kind. An unmapped kind stays silent: counting it as
  // ignored would flood the chip with every like in the room.
  function applyInteraction(msg) {
    const rule = bridgeRules.get(String(msg.kind || ''));
    if (!rule) return;
    const user = msg.user || {};
    const perGift = rule.count ?? APPLES_PER_GIFT[rule.effect] ?? 1;
    if (typeof onGift === 'function') onGift(rule.effect, user.uniqueId || user.nickname || 'viewer', perGift);
  }

  function handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'catalog') applyCatalog(msg.gifts);
    else if (msg.t === 'rules') applyRules(msg.rules);
    else if (msg.t === 'gift') applyGift(msg);
    else if (msg.t === 'interaction') applyInteraction(msg);
    else if (msg.t === 'status') {
      bridgeState = typeof msg.state === 'string' && msg.state ? msg.state : null;
      bridgeDetail = typeof msg.detail === 'string' ? msg.detail : '';
      if (typeof msg.user === 'string') bridgeRoom = msg.user;
      report();
    }
  }

  function setEnabled(next) {
    next = Boolean(next);
    if (next === enabled) return;
    enabled = next;
    if (next) { connect(); return; }
    stopRetry();
    const ws = socket;
    socket = null; bridgeState = null; bridgeDetail = '';
    if (ws) {
      ws.onclose = null; // a deliberate close must not schedule a retry
      try { ws.close(); } catch {}
    }
    report();
  }

  function status() { return { state: state(), ignored, room: bridgeRoom }; }

  function unknown() { return unknowns.map((item) => ({ ...item })); }

  return { setEnabled, reconnect, status, unknown };
}
