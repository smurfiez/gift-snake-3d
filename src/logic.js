export const CONFIG = Object.freeze({
  startLength: 3,
  minLength: 3,
  boardW: 12,
  boardH: 13,
  tickMs: 200,
  minTick: 80,
  maxTick: 400,
  speedStep: 15,
  slowStep: 20,
  appleIntervalMs: 1200,
  maxApples: 5,
  giftApples: 1,
  bombCut: 2,
  rescueMs: 10000,
  restartMs: 3000,
});

export const DIR = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
});

const DIRS = [DIR.up, DIR.right, DIR.down, DIR.left];

const key = (p) => `${p.x},${p.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;

const cycleCache = new Map();

// A Hamiltonian cycle exists whenever one side is even. The 12-wide board
// therefore gets a full cycle; the 13-wide one gets none.
function hamiltonCycle(w, h) {
  if (w % 2 === 1 && h % 2 === 1) return null;
  const ck = `${w}x${h}`;
  if (cycleCache.has(ck)) return cycleCache.get(ck);

  const cells = [{ x: 0, y: 0 }];
  if (h % 2 === 0) {
    for (let y = 0; y < h; y++) {
      if (y % 2 === 0) for (let x = 1; x < w; x++) cells.push({ x, y });
      else for (let x = w - 1; x >= 1; x--) cells.push({ x, y });
    }
    for (let y = h - 1; y >= 1; y--) cells.push({ x: 0, y });
  } else {
    for (let x = 0; x < w; x++) {
      if (x % 2 === 0) for (let y = 1; y < h; y++) cells.push({ x, y });
      else for (let y = h - 1; y >= 1; y--) cells.push({ x, y });
    }
    for (let x = w - 1; x >= 1; x--) cells.push({ x, y: 0 });
  }

  const order = new Map();
  for (let i = 0; i < cells.length; i++) order.set(key(cells[i]), i);
  const cycle = { cells, order, n: cells.length };
  cycleCache.set(ck, cycle);
  return cycle;
}

function cycleMove(state, cycle, body) {
  const head = body[0];
  const idx = cycle.order.get(key(head));
  if (idx === undefined) return null;
  const target = cycle.cells[(idx + 1) % cycle.n];
  for (let i = 0; i < body.length - 1; i++) {
    if (same(body[i], target)) return null;
  }
  for (const d of DIRS) {
    if (head.x + d.x === target.x && head.y + d.y === target.y) return d;
  }
  return null;
}

function cycleAligned(cycle, body) {
  const n = cycle.n;
  const headIdx = cycle.order.get(key(body[0]));
  if (headIdx === undefined) return false;
  for (let i = 1; i < body.length; i++) {
    const idx = cycle.order.get(key(body[i]));
    if (idx === undefined || idx !== (headIdx - i + n * 2) % n) return false;
  }
  return true;
}

export function createState(rand = Math.random) {
  const w = CONFIG.boardW;
  const h = CONFIG.boardH;
  const cycle = hamiltonCycle(w, h);
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  let headIdx = 0;
  let best = Infinity;
  for (let i = 0; i < cycle.n; i++) {
    const d = Math.abs(cycle.cells[i].x - cx) + Math.abs(cycle.cells[i].y - cy);
    if (d < best) {
      best = d;
      headIdx = i;
    }
  }

  // Start on the cycle so every later cycle step is collision-free.
  const n = cycle.n;
  const snake = [];
  for (let i = 0; i < CONFIG.startLength; i++) {
    const c = cycle.cells[(headIdx - i + n * 2) % n];
    snake.push({ x: c.x, y: c.y });
  }
  const next = cycle.cells[(headIdx + 1) % n];
  const dir = { x: next.x - snake[0].x, y: next.y - snake[0].y };

  const state = {
    w,
    h,
    snake,
    apples: [],
    dir,
    lastMove: { ...dir },
    tickMs: CONFIG.tickMs,
    dead: false,
    won: false,
    rescuing: false,
    rescueMs: 0,
    nextAppleId: 1,
    rand,
  };
  spawnApple(state);
  return state;
}

export function inBounds(state, p) {
  return p.x >= 0 && p.y >= 0 && p.x < state.w && p.y < state.h;
}

export function appleAt(state, p) {
  return state.apples.find((a) => same(a, p)) || null;
}

export function spawnApple(state) {
  const taken = new Set([...state.snake.map(key), ...state.apples.map(key)]);
  const free = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return null;

  const rand = state.rand ?? Math.random;
  const p = free[Math.floor(rand() * free.length)];
  const apple = { id: state.nextAppleId++, x: p.x, y: p.y };
  state.apples.push(apple);
  return apple;
}

export function step(state) {
  if (state.dead || state.won || state.rescuing) return { moved: false };

  state.lastMove = { ...state.dir };
  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  if (!inBounds(state, next)) {
    state.dead = true;
    return { moved: false, died: true, reason: 'wall' };
  }

  const apple = appleAt(state, next);
  const body = apple ? state.snake : state.snake.slice(0, -1);
  if (body.some((s) => same(s, next))) {
    state.rescuing = true;
    state.rescueMs = CONFIG.rescueMs;
    return { moved: false, died: true, reason: 'self', rescue: true };
  }

  state.snake.unshift(next);
  if (apple) state.apples.splice(state.apples.indexOf(apple), 1);
  else state.snake.pop();

  if (state.snake.length >= state.w * state.h) state.won = true;
  return { moved: true, ate: apple, died: false, won: state.won };
}

// Self-collision freezes the snake; a bomb shortens it and ends the freeze.
export function updateRescue(state, dtMs) {
  if (!state.rescuing) return { died: false };
  state.rescueMs -= dtMs;
  if (state.rescueMs > 0) return { died: false, msLeft: state.rescueMs };
  state.rescuing = false;
  state.rescueMs = 0;
  state.dead = true;
  return { died: true };
}

export function applyGift(state, type) {
  if (state.dead || state.won) return { type, ok: false };
  if (state.rescuing && type !== 'bomb') return { type, ok: false };

  switch (type) {
    case 'apple': {
      const apples = [];
      for (let i = 0; i < CONFIG.giftApples; i++) {
        const a = spawnApple(state);
        if (a) apples.push(a);
      }
      return { type, ok: apples.length > 0, apples };
    }
    case 'bomb': {
      const removable = Math.min(CONFIG.bombCut, state.snake.length - CONFIG.minLength);
      const removed =
        removable > 0 ? state.snake.splice(state.snake.length - removable, removable) : [];
      if (removed.length) {
        state.rescuing = false;
        state.rescueMs = 0;
      }
      return { type, ok: removed.length > 0, removed };
    }
    case 'speed': {
      const next = Math.max(CONFIG.minTick, state.tickMs - CONFIG.speedStep);
      const ok = next < state.tickMs;
      state.tickMs = next;
      return { type, ok, tickMs: state.tickMs };
    }
    case 'slow': {
      const next = Math.min(CONFIG.maxTick, state.tickMs + CONFIG.slowStep);
      const ok = next > state.tickMs;
      state.tickMs = next;
      return { type, ok, tickMs: state.tickMs };
    }
    default:
      return { type, ok: false };
  }
}

function bodySet(body) {
  const set = new Set();
  for (let i = 0; i < body.length - 1; i++) set.add(key(body[i]));
  return set;
}

function neighborList(state, blocked, pos, visited) {
  const out = [];
  for (const d of DIRS) {
    const c = { x: pos.x + d.x, y: pos.y + d.y };
    if (!inBounds(state, c)) continue;
    const k = key(c);
    if (visited && visited.has(k)) continue;
    if (blocked.has(k)) continue;
    out.push({ d, c, k });
  }
  return out;
}

// BFS to the nearest cell in `goals`. The tail cell counts as free because it
// vacates when the head advances.
function shortestPathTo(state, body, goals, rand = Math.random) {
  if (!body.length || !goals.length) return null;
  const head = body[0];
  const blocked = bodySet(body);
  const goalKeys = new Set(goals.map(key));
  const visited = new Set([key(head)]);
  const queue = [{ p: head, path: [] }];

  while (queue.length) {
    const cur = queue.shift();
    if (goalKeys.has(key(cur.p))) return { path: cur.path, target: cur.p };
    const next = neighborList(state, blocked, cur.p, visited);
    for (let i = next.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [next[i], next[j]] = [next[j], next[i]];
    }
    for (const n of next) {
      visited.add(n.k);
      queue.push({ p: n.c, path: cur.path.concat(n.d) });
    }
  }
  return null;
}

function simulateMoves(body, path, apples) {
  const b = body.map((p) => ({ x: p.x, y: p.y }));
  const food = apples.map((p) => ({ x: p.x, y: p.y }));
  for (const d of path) {
    const next = { x: b[0].x + d.x, y: b[0].y + d.y };
    const eat = food.findIndex((a) => same(a, next));
    b.unshift(next);
    if (eat >= 0) food.splice(eat, 1);
    else b.pop();
  }
  return b;
}

// Trips of three cells around each step of the shortest path; breaks the
// head-chases-tail loop that makes a long snake orbit instead of filling space.
function extendPath(state, body, shortest) {
  const blocked = bodySet(body);
  const out = [];
  const second = body[1];
  let cur = body[0];

  for (const d of shortest) {
    const next = { x: cur.x + d.x, y: cur.y + d.y };
    const perps = d.x !== 0 ? [DIR.up, DIR.down] : [DIR.left, DIR.right];
    let extended = false;

    for (const t of perps) {
      const sideA = { x: cur.x + t.x, y: cur.y + t.y };
      const sideB = { x: next.x + t.x, y: next.y + t.y };
      const aOpen = inBounds(state, sideA) && !blocked.has(key(sideA)) && !appleAt(state, sideA);
      const bOpen =
        (inBounds(state, sideB) && !blocked.has(key(sideB))) ||
        (second && same(sideB, second));
      if (aOpen && bOpen) {
        out.push(t, d, { x: -t.x, y: -t.y });
        extended = true;
        break;
      }
    }
    if (!extended) out.push(d);
    cur = next;
  }
  return out;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestAppleDistance(p, apples) {
  let best = Infinity;
  for (const a of apples) best = Math.min(best, manhattan(p, a));
  return best;
}

// A move is safe when the head can still reach its own tail afterwards, i.e.
// it does not walk into a pocket that closes behind it.
function tailReachableAfter(state, body, d) {
  const after = simulateMoves(body, [d], state.apples);
  return !!shortestPathTo(state, after, [after[after.length - 1]]);
}

// Food-first agent:
// 1. if any apple is reachable, take the first step of the shortest path to
//    the nearest one; no tail, escape or cycle check may veto that move, so
//    the snake may box itself in and die. A bomb during the rescue is the
//    player's way out.
// 2. otherwise follow the Hamiltonian cycle; the body starts on it and stays
//    aligned, so the snake sweeps every cell without boxing itself in
// 3. otherwise take a longer side-stepping path to the tail
// 4. otherwise move away from the food to open space
export function chooseMove(state, rand = Math.random) {
  if (state.dead || state.won || state.rescuing) return { ...state.dir };

  const body = state.snake;
  if (!body.length) return { ...state.dir };

  const foodPaths = state.apples
    .map((a) => shortestPathTo(state, body, [a], rand))
    .filter((p) => p && p.path.length)
    .sort((a, b) => a.path.length - b.path.length);
  if (foodPaths.length) {
    // Equal-length routes are common; roll between them so consecutive rounds
    // do not replay the exact same movement line.
    const best = foodPaths[0].path.length;
    const tied = foodPaths.filter((p) => p.path.length === best);
    return { ...tied[(rand() * tied.length) | 0].path[0] };
  }

  const blocked = bodySet(body);
  const options = neighborList(state, blocked, body[0]);
  if (!options.length) return { ...state.dir };
  const safe = options.filter((o) => tailReachableAfter(state, body, o.d));

  const cycle = hamiltonCycle(state.w, state.h);
  if (cycle && cycleAligned(cycle, body)) {
    const d = cycleMove(state, cycle, body);
    if (d) return { ...d };
  }

  const tailPath = shortestPathTo(state, body, [body[body.length - 1]]);
  if (tailPath && tailPath.path.length) {
    const longer = extendPath(state, body, tailPath.path);
    if (longer.length && safe.some((o) => same(o.d, longer[0]))) return { ...longer[0] };
  }

  const picks = safe.length ? safe : options;
  if (state.apples.length) {
    picks.sort(
      (a, b) =>
        nearestAppleDistance(b.c, state.apples) - nearestAppleDistance(a.c, state.apples)
    );
  }
  return { ...picks[0].d };
}

