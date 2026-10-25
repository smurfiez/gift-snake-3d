import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { createComboFolder, normalizeCatalog } from './normalize.mjs';

const user = (process.env.TIKTOK_USER || '').trim().replace(/^@/, '');
if (!user) {
  console.error('missing TIKTOK_USER: run TIKTOK_USER=<username> node server/bridge.mjs');
  process.exit(1);
}

const port = Number(process.env.PORT) || 8765;
const sessionId = process.env.TIKTOK_SESSION_ID || '';
const targetIdc = process.env.TIKTOK_TARGET_IDC || '';
const retryDelay = 5000;

// Mirrors the client seed table so the log can show which gifts the game maps.
const SEED_NAMES = new Set([
  'rose', 'finger heart', 'tiktok', 'hand hearts', 'ice cream cone',
  'doughnut', 'corgi', 'galaxy', 'lion', 'universe', 'sunglasses', 'cap',
]);

let status = { state: 'offline', detail: 'starting' };
let catalog = [];
let giftNames = new Map();
let seenGiftShape = false;
const folder = createComboFolder();
let connection = null;
let retryTimer = null;
let attempting = false;
if (sessionId && !targetIdc) {
  console.log('note: TIKTOK_TARGET_IDC unset, authenticated socket may be rejected');
}

const wss = new WebSocketServer({ host: '127.0.0.1', port });
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (msg) => wss.clients.forEach((ws) => send(ws, msg));

wss.on('listening', () => console.log(`bridge listening on ws://127.0.0.1:${port}`));
wss.on('error', (err) => {
  console.error(`websocket server error: ${err.message}`);
  process.exit(1);
});
wss.on('connection', (ws) => {
  console.log(`client connected (${wss.clients.size} total)`);
  send(ws, { t: 'catalog', gifts: catalog });
  send(ws, { t: 'status', ...status });
  ws.on('close', () => console.log(`client disconnected (${wss.clients.size} left)`));
  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (msg?.t === 'ping') send(ws, { t: 'status', ...status });
  });
});

const setStatus = (state, detail) => {
  if (status.state === state && status.detail === detail) return;
  status = { state, detail };
  broadcast({ t: 'status', state, detail });
  console.log(`tiktok: ${state} ${detail}`);
};

// The room ships 600+ gifts; only the mapped ones matter for the game, so the
// log stays short enough to read while the stream runs.
const catalogTable = (gifts) =>
  console.log(
    [`catalog: ${gifts.length} gifts`]
      .concat(
        gifts
          .filter((g) => SEED_NAMES.has(g.name.toLowerCase()))
          .map((g) => `  ${String(g.id).padStart(9)}  ${g.name}  ${g.coins} coins`)
      )
      .join('\n')
  );

const onGift = (raw) => {
  // Gift events carry only an id when extended gift info is off, so the name
  // comes from the freshly fetched catalog.
  if (raw && raw.giftName === undefined && raw.giftId != null) {
    const name = giftNames.get(Number(raw.giftId));
    if (name) raw.giftName = name;
  }
  if (!seenGiftShape) {
    seenGiftShape = true;
    const u = raw?.user || {};
    console.log(
      `gift shape: giftId=${raw?.giftId} user.id=${u.id} idStr=${u.idStr} displayId=${u.displayId} uniqueId=${u.uniqueId} nickname=${u.nickname}`
    );
  }
  let event;
  try {
    event = folder.push(raw);
  } catch (err) {
    console.error(`gift parse failed: ${err.message}`);
    return;
  }
  if (!event) return;
  broadcast(event);
  console.log(
    `gift ${event.giftId} ${event.name} x${event.count} @${event.user.uniqueId || event.user.nickname || '?'} (${event.coins} coins) user=${JSON.stringify(event.user)}`
  );
};

const scheduleRetry = () => {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    connect();
  }, retryDelay);
};

const watch = (conn) => {
  conn.on('disconnected', () => {
    if (conn !== connection) return;
    setStatus('offline', 'disconnected');
    scheduleRetry();
  });
  conn.on('streamEnd', () => {
    if (conn !== connection) return;
    setStatus('offline', 'stream ended');
    scheduleRetry();
  });
  conn.on('error', ({ exception, message } = {}) =>
    console.error(`tiktok error: ${exception?.message || message || 'unknown'}`)
  );
  try {
    conn.on(WebcastEvent.GIFT, onGift);
  } catch {
    conn.on('gift', onGift);
  }
};

// Extended gift info is fetched through the signed gift list, which Euler sells
// as a Business plan route. The same list is served unsigned, so the bridge
// builds its own id -> name table and never touches the sign server.
async function fetchUnsignedCatalog(conn) {
  const res = await conn.webClient.getJsonObjectFromWebcastApi('gift/list/', { room_id: conn.roomId }, false);
  return normalizeCatalog(res?.data?.gifts || []);
}

const connect = async () => {
  if (attempting) return;
  attempting = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const options = { enableExtendedGiftInfo: false };
  const signApiKey = (process.env.TIKTOK_SIGN_API_KEY || '').trim();
  if (signApiKey) options.signApiKey = signApiKey;
  if (sessionId) {
    options.authenticateWs = true;
    options.session = {
      cookie: { type: 'cookie', value: { sessionId, ttTargetIdc: targetIdc } },
    };
  }
  try {
    connection = new TikTokLiveConnection(user, options);
    watch(connection);
    await connection.connect();
  } catch (err) {
    attempting = false;
    connection = null;
    setStatus('offline', err?.message || String(err));
    scheduleRetry();
    return;
  }
  attempting = false;
  try {
    catalog = await fetchUnsignedCatalog(connection);
  } catch (err) {
    console.error(`gift catalog fetch failed: ${err.message}`);
    catalog = [];
  }
  giftNames = new Map(catalog.map((g) => [g.id, g.name]));
  broadcast({ t: 'catalog', gifts: catalog });
  setStatus('live', `@${user}`);
  catalogTable(catalog);
};

process.on('SIGINT', () => {
  console.log('bridge stopping');
  try {
    connection?.disconnect();
  } catch {}
  wss.close();
  process.exit(0);
});

connect();
