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

const MAX_PER_COMBO = 3;
const UNKNOWN_LIMIT = 20;
const RETRY_MS = 3000;
const SEED_BY_NAME = new Map(Object.entries(SEED).map(([name, effect]) => [name.toLowerCase(), effect]));
const normaliseName = (name) => String(name ?? '').trim().toLowerCase();

export function createTikTokFeed({ onGift, onStatus, url = 'ws://127.0.0.1:8765' } = {}) {
  let enabled = false, socket = null, retryTimer = null, bridgeState = null, bridgeDetail = '';
  let seedById = new Map(), ignored = 0, unknowns = [];
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

  function applyGift(msg) {
    const key = String(msg.giftId);
    const effect = GIFT_MAP[key] ?? seedById.get(key);
    if (!effect) {
      ignored += 1;
      unknowns.push({ giftId: msg.giftId, name: msg.name ?? '' });
      if (unknowns.length > UNKNOWN_LIMIT) unknowns.shift();
      report();
      return;
    }
    const user = msg.user || {};
    const count = Number(msg.count);
    const applied = Math.min(count > 0 ? Math.floor(count) : 1, MAX_PER_COMBO);
    // Handles are stable and unique; the display nickname can repeat or contain
    // spaces, which breaks the @mention look in toasts and the leaderboard.
    if (typeof onGift === 'function') onGift(effect, user.uniqueId || user.nickname || 'viewer', applied);
  }

  function handle(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'catalog') applyCatalog(msg.gifts);
    else if (msg.t === 'gift') applyGift(msg);
    else if (msg.t === 'status') {
      bridgeState = typeof msg.state === 'string' && msg.state ? msg.state : null;
      bridgeDetail = typeof msg.detail === 'string' ? msg.detail : '';
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

  function status() { return { state: state(), ignored }; }

  function unknown() { return unknowns.map((item) => ({ ...item })); }

  return { setEnabled, status, unknown };
}
