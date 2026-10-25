// Fake TikTok gift feed for local development. Run with `node scripts/feed.mjs`,
// `node scripts/feed.mjs Rose 3`, or `node scripts/feed.mjs --once`.
import { WebSocketServer } from 'ws';

const GIFTS = [
  ['Rose', 1001, 1],
  ['Finger Heart', 1002, 5],
  ['TikTok', 1003, 1],
  ['Hand Hearts', 1004, 10],
  ['Ice Cream Cone', 1005, 20],
  ['Doughnut', 1006, 30],
  ['Corgi', 1007, 299],
  ['Galaxy', 1008, 1000],
  ['Lion', 1009, 2999],
  ['Universe', 1010, 34999],
  ['Sunglasses', 1011, 50],
  ['Cap', 1012, 99],
].map(([name, id, coins]) => ({ id, name, coins }));

const USERS = ['nova', 'kito', 'mira'];

const argv = process.argv.slice(2);
const positional = [];
let every = 2000;
let once = false;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--every') every = Number(argv[++i]);
  else if (argv[i] === '--once') once = true;
  else positional.push(argv[i]);
}
if (!Number.isFinite(every) || every <= 0) every = 2000;

const wanted = positional[0];
const count = Math.max(1, Number(positional[1]) || 1);
const scripted = wanted ? GIFTS.find((g) => g.name.toLowerCase() === wanted.toLowerCase()) : null;
if (wanted && !scripted) {
  console.error(`unknown gift "${wanted}"`);
  console.error(`valid gifts: ${GIFTS.map((g) => g.name).join(', ')}`);
  process.exit(1);
}

let userIndex = 0;
let giftIndex = 0;

function giftMessage(gift, times) {
  const uniqueId = USERS[userIndex++ % USERS.length];
  console.log(`feed ${gift.name} x${times} @${uniqueId}`);
  return {
    t: 'gift',
    giftId: gift.id,
    name: gift.name,
    count: times,
    coins: gift.coins * times,
    user: { uniqueId, nickname: uniqueId[0].toUpperCase() + uniqueId.slice(1) },
  };
}

if (once) {
  giftMessage(scripted || GIFTS[0], count);
  setTimeout(() => process.exit(0), 500);
} else {
  const port = Number(process.env.PORT) || 8765;
  const wss = new WebSocketServer({ host: '127.0.0.1', port });
  console.log(`fake feed listening on ws://127.0.0.1:${port}`);

  const send = (ws, message) => {
    if (ws.readyState === 1) ws.send(JSON.stringify(message));
  };

  wss.on('connection', (ws) => {
    console.log('feed client connected');
    send(ws, { t: 'status', state: 'live', detail: 'fake feed' });
    send(ws, { t: 'catalog', gifts: GIFTS });

    let timer = null;
    if (scripted) {
      for (let i = 0; i < count; i++) send(ws, giftMessage(scripted, 1));
    } else {
      timer = setInterval(() => send(ws, giftMessage(GIFTS[giftIndex++ % GIFTS.length], 1)), every);
    }

    ws.on('close', () => {
      if (timer) clearInterval(timer);
      console.log('feed client disconnected');
    });
  });
}
