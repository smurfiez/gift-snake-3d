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
  maxBombs: 3,
  rescueMs: 10000,
  restartMs: 3000,
  // After the board fills, the snake keeps moving for this long before the win
  // is awarded, so the round ends on a visible victory lap instead of a freeze.
  winDelayMs: 10000,
  // Planner tuning. The margin is the number of free cells the head must keep
  // beyond the snake's own length before a move counts as safe.
  safeMargin: 4,
  // How far off the fill order the snake may go to eat a bomb. Skipped cells are
  // reclaimed on a later lap, so this is a pacing knob, not a safety one.
  bombReach: 10,
  // Chance per move that the AI misjudges and starts playing greedily for the
  // rest of the round. Keeps the snake beatable, so a rescue actually matters.
  slipChance: 0.00006,
  dramaChance: 0.2,
  dramaCooldown: 6,
  dramaMaxCost: 2,
  recentMemory: 16,
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

// Concentric-ring Hamiltonian cycle. Rings are peeled from the outside in, each
// ring walking its perimeter except for one seam cell on the middle row; the
// growing body therefore draws nested rectangles instead of stripes. Returns
// null for shapes this construction cannot close, which then fall back to the
// serpentine cycle below.
//
// Seam: row y = H/2, one cell per ring at x = ring index, walked back out at the
// end; the final step closes onto the first cell.
function ringCycle(w, h) {
  let W = w;
  let H = h;
  let transposed = false;
  if (W > H) {
    const t = W;
    W = H;
    H = t;
    transposed = true;
  }
  if (W % 2 !== 0 || H !== W + 1) return null;

  const R = W / 2;
  const S = H >> 1;
  const ring = (x, y) => Math.min(x, y, W - 1 - x, H - 1 - y);
  const isSeam = (x, y) => y === S && x === ring(x, y);
  const used = new Uint8Array(W * H);
  const path = [];

  for (let r = 0; r < R; r++) {
    const startY = S - (r % 2 === 0 ? 1 : -1);
    const endY = S + (r % 2 === 0 ? 1 : -1);
    const ringSize = 2 * (W - 2 * r + H - 2 * r) - 4;
    const local = new Set();
    let x = r;
    let y = startY;

    for (;;) {
      if (x < 0 || y < 0 || x >= W || y >= H) return null;
      if (ring(x, y) !== r || isSeam(x, y)) return null;
      const id = y * W + x;
      if (used[id] || local.has(id)) return null;
      local.add(id);
      used[id] = 1;
      path.push({ x, y });
      if (x === r && y === endY) break;

      let next = null;
      for (const d of DIRS) {
        const nx = x + d.x;
        const ny = y + d.y;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (ring(nx, ny) !== r || isSeam(nx, ny)) continue;
        if (local.has(ny * W + nx)) continue;
        next = [nx, ny];
        break;
      }
      if (!next) return null;
      [x, y] = next;
    }

    if (local.size !== ringSize - 1) return null;
  }

  for (let x = R - 1; x >= 0; x--) {
    const id = S * W + x;
    if (used[id]) return null;
    used[id] = 1;
    path.push({ x, y: S });
  }

  if (path.length !== W * H) return null;

  if (transposed) {
    for (const c of path) {
      const t = c.x;
      c.x = c.y;
      c.y = t;
    }
  }
  return path;
}

// Serpentine cycle: a fallback for shapes the ring construction cannot close.
// A Hamiltonian cycle exists whenever one side is even; the 12-wide board gets a
// full cycle, the odd-by-odd ones get none.
function serpentineCells(w, h) {
  if (w % 2 === 1 && h % 2 === 1) return null;

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
  return cells;
}

// Pattern families. Each round picks one, so the board does not replay the same
// shape every time: rings or serpentine, on either axis, then a symmetry.
export const FILL_PATTERNS = 32;

// Family = which base route: rings or serpentine, each on either axis.
function patternCells(w, h, family) {
  if (family === 0) return ringCycle(w, h);
  if (family === 1) {
    const cells = ringCycle(h, w);
    return cells && cells.map((c) => ({ x: c.y, y: c.x }));
  }
  if (family === 2) return serpentineCells(w, h);
  const cells = serpentineCells(h, w);
  return cells && cells.map((c) => ({ x: c.y, y: c.x }));
}

// The order the body grows along, cached per board size and pattern. Bits 0-1
// pick the family, 2-4 apply a mirror or reverse so the same family still reads
// differently from round to round.
export function fillOrder(w, h, variant = 0) {
  const v = ((variant % FILL_PATTERNS) + FILL_PATTERNS) % FILL_PATTERNS;
  const ck = `${w}x${h}:${v}`;
  if (cycleCache.has(ck)) return cycleCache.get(ck);

  let cells = patternCells(w, h, v & 3);
  if (!cells) return null;

  if (v & 4) cells = cells.map((c) => ({ x: w - 1 - c.x, y: c.y }));
  if (v & 8) cells = cells.map((c) => ({ x: c.x, y: h - 1 - c.y }));
  if (v & 16) cells = cells.slice().reverse();

  const ids = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < cells.length; i++) ids[cells[i].y * w + cells[i].x] = i;
  const order = { cells, ids, w, h, n: cells.length, variant: v };
  cycleCache.set(ck, order);
  return order;
}

function cycleIndex(cycle, p) {
  if (p.x < 0 || p.y < 0 || p.x >= cycle.w || p.y >= cycle.h) return -1;
  return cycle.ids[p.y * cycle.w + p.x];
}

// The body is ordered when, read head to tail, each segment sits strictly
// further behind the head along the cycle. While that holds the cell after the
// head on the cycle can never be part of the body, so the snake can keep
// moving around the cycle forever without ever meeting itself.
// A body is ordered when its cells on the order sit strictly behind the head.
// Cells eaten off the order by a safe detour are ignored: they are extra body
// that the tail carries away, not part of the route.
function cycleOrdered(cycle, body) {
  let start = 0;
  let headIdx = cycleIndex(cycle, body[0]);
  if (headIdx < 0) {
    start = 1;
    while (start < body.length && cycleIndex(cycle, body[start]) < 0) start++;
    if (start >= body.length) return false;
    headIdx = cycleIndex(cycle, body[start]);
  }
  let prev = 0;
  for (let i = start + 1; i < body.length; i++) {
    const idx = cycleIndex(cycle, body[i]);
    if (idx < 0) continue;
    const behind = (headIdx - idx + cycle.n) % cycle.n;
    if (behind <= prev) return false;
    prev = behind;
  }
  return true;
}

// A jump is safe when the body it leaves is still ordered, i.e. every survivor
// stays strictly behind the new head along the cycle. Returns the index the
// head would land on, or -1 when the jump would break the invariant.
function jumpKeepsOrder(cycle, body, target, eats) {
  const targetIdx = cycleIndex(cycle, target);
  if (targetIdx < 0) return -1;
  const last = eats ? body.length - 1 : body.length - 2;
  let prev = 0;
  for (let i = 0; i <= last; i++) {
    const idx = cycleIndex(cycle, body[i]);
    if (idx < 0) continue;
    const behind = (targetIdx - idx + cycle.n) % cycle.n;
    if (behind <= prev) return -1;
    prev = behind;
  }
  return targetIdx;
}

export function createState(rand = Math.random) {
  const w = CONFIG.boardW;
  const h = CONFIG.boardH;
  // A new pattern each round, so the stream does not replay one shape forever.
  // Rings are the signature look, so they get three rounds in four; the two
  // serpentine families fill the rest. Bits 0-1 pick the family, 2-4 a mirror or
  // reverse.
  const family = rand() < 0.75 ? Math.floor(rand() * 2) : 2 + Math.floor(rand() * 2);
  const variant = family | (Math.floor(rand() * 8) << 2);
  const cycle = fillOrder(w, h, variant);
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
    filled: false,
    winMs: 0,
    rescuing: false,
    rescueMs: 0,
    bombs: [],
    variant,
    nextAppleId: 1,
    nextBombId: 1,
    eaten: 0,
    recent: [],
    dramaCooldown: 0,
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

// Free cells just ahead on the fill order. Items placed here are eaten within a
// second or two, which is how the snake "goes for" a gift without ever leaving
// the pattern.
export function upcomingCells(state, count) {
  const order = fillOrder(state.w, state.h, state.variant || 0);
  if (!order) return [];
  const head = state.snake[0];
  const headIdx = order.ids[head.y * state.w + head.x];
  if (headIdx < 0) return [];
  const taken = new Set([
    ...state.snake.map(key),
    ...state.apples.map(key),
    ...(state.bombs || []).map(key),
  ]);
  const out = [];
  for (let i = 1; i <= count; i++) {
    const c = order.cells[(headIdx + i) % order.n];
    if (!taken.has(key(c))) out.push({ x: c.x, y: c.y });
  }
  return out;
}

function placeApple(state, p) {
  const apple = { id: state.nextAppleId++, x: p.x, y: p.y };
  state.apples.push(apple);
  return apple;
}

function freeCells(state) {
  const taken = new Set([
    ...state.snake.map(key),
    ...state.apples.map(key),
    ...(state.bombs || []).map(key),
  ]);
  const free = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  return free;
}

// Procedural apples only ever take a free cell. A full board (victory lap) gets
// none, and spawning resumes by itself once a cell frees up.
export function spawnApple(state) {
  if (state.filled || state.won) return null;
  const rand = state.rand ?? Math.random;
  const ahead = upcomingCells(state, 8);
  if (ahead.length && rand() < 0.75) return placeApple(state, ahead[Math.floor(rand() * ahead.length)]);

  const free = freeCells(state);
  if (!free.length) return null;
  return placeApple(state, free[Math.floor(rand() * free.length)]);
}

// Gift apples are never refused: with no free cell the apple takes the tail, so
// the snake shortens by one and the drop still lands.
export function spawnGiftApple(state) {
  const rand = state.rand ?? Math.random;
  const ahead = upcomingCells(state, 8);
  if (ahead.length && rand() < 0.75) return placeApple(state, ahead[Math.floor(rand() * ahead.length)]);

  const free = freeCells(state);
  if (free.length) return placeApple(state, free[Math.floor(rand() * free.length)]);
  if (state.snake.length <= CONFIG.minLength) return null;
  return placeApple(state, state.snake.pop());
}

export function bombAt(state, p) {
  return (state.bombs || []).find((b) => same(b, p)) || null;
}

// Bombs live on the board like apples and only act when the snake eats one.
// A dropped bomb is not a board object yet: it only becomes one on landing, so
// it cannot be eaten, targeted or counted while it is still falling.
export function pickBombCell(state) {
  if (!Array.isArray(state.bombs)) state.bombs = [];
  if (state.bombs.length >= CONFIG.maxBombs) return null;

  // A gifted bomb lands just ahead of the head when it can, so the snake eats it
  // almost immediately, and drops to a random free cell otherwise.
  const rand = state.rand ?? Math.random;
  const ahead = upcomingCells(state, 4);
  if (ahead.length && rand() < 0.9) return ahead[Math.floor(rand() * ahead.length)];

  const taken = new Set([
    ...state.snake.map(key),
    ...state.apples.map(key),
    ...state.bombs.map(key),
  ]);
  const free = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return null;
  return free[Math.floor(rand() * free.length)];
}

// Turns a landed drop into a bomb on the board. Returns null when the cell was
// taken while the bomb was falling or the board is already at the cap.
export function spawnBombAt(state, cell) {
  if (!Array.isArray(state.bombs)) state.bombs = [];
  if (state.bombs.length >= CONFIG.maxBombs) return null;
  if (cell.x < 0 || cell.y < 0 || cell.x >= state.w || cell.y >= state.h) return null;
  const k = key(cell);
  if (state.snake.some((s) => key(s) === k)) return null;
  if (state.apples.some((a) => key(a) === k)) return null;
  if (state.bombs.some((b) => key(b) === k)) return null;

  const bomb = { id: state.nextBombId++, x: cell.x, y: cell.y };
  state.bombs.push(bomb);
  return bomb;
}

export function spawnBomb(state) {
  const cell = pickBombCell(state);
  return cell ? spawnBombAt(state, cell) : null;
}

// What eating a bomb does: drop it from the board and cut the tail. Also used
// when a dropped bomb lands on the snake and is delivered straight to the head.
export function eatBomb(state, bomb) {
  state.bombsEaten = (state.bombsEaten || 0) + 1;
  if (bomb && Array.isArray(state.bombs)) {
    const at = state.bombs.indexOf(bomb);
    if (at >= 0) state.bombs.splice(at, 1);
  }
  const cut = Math.min(CONFIG.bombCut, state.snake.length - CONFIG.minLength);
  return cut > 0 ? state.snake.splice(state.snake.length - cut, cut) : [];
}

export function step(state) {
  if (state.dead || state.won || state.rescuing) return { moved: false };

  state.lastMove = { ...state.dir };
  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  if (!inBounds(state, next)) {
    // On a full board there is nowhere to go; hold rather than lose the win.
    if (state.filled) return { moved: false, held: true, died: false };
    state.dead = true;
    return { moved: false, died: true, reason: 'wall' };
  }

  const apple = appleAt(state, next);
  const bomb = bombAt(state, next);
  const body = apple ? state.snake : state.snake.slice(0, -1);
  if (body.some((s) => same(s, next))) {
    if (state.filled) return { moved: false, held: true, died: false };
    state.rescuing = true;
    state.rescueMs = CONFIG.rescueMs;
    return { moved: false, died: true, reason: 'self', rescue: true };
  }

  state.snake.unshift(next);
  if (apple) {
    state.apples.splice(state.apples.indexOf(apple), 1);
    state.eaten = (state.eaten || 0) + 1;
  } else state.snake.pop();

  let removed = [];
  if (bomb) removed = eatBomb(state, bomb);

  if (state.snake.length >= state.w * state.h) {
    if (!state.filled) {
      state.filled = true;
      state.winMs = state.winDelayMs ?? CONFIG.winDelayMs;
      if (state.winMs <= 0) state.won = true;
    }
  } else if (state.filled) {
    // A bomb cut the snake back below a full board: the lap is off.
    state.filled = false;
    state.winMs = 0;
  }

  return {
    moved: true,
    ate: apple,
    bomb,
    removed,
    died: false,
    won: state.won,
    filled: state.filled,
  };
}

// Victory lap clock. The win is only awarded once the full-board snake has kept
// moving for CONFIG.winDelayMs.
export function updateWin(state, dtMs) {
  if (state.won || !state.filled) return { won: false };
  state.winMs -= dtMs;
  if (state.winMs > 0) return { won: false, msLeft: state.winMs };
  state.winMs = 0;
  state.won = true;
  return { won: true };
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
        const a = spawnGiftApple(state);
        if (a) apples.push(a);
      }
      return { type, ok: apples.length > 0, apples };
    }
    case 'bomb': {
      // Bombs are board objects now: the snake has to eat one for the cut to
      // happen. A rescue is the exception, because a frozen snake cannot move
      // to reach it and that window is the only way out.
      if (state.rescuing) {
        const removable = Math.min(CONFIG.bombCut, state.snake.length - CONFIG.minLength);
        const removed =
          removable > 0 ? state.snake.splice(state.snake.length - removable, removable) : [];
        if (removed.length) {
          state.rescuing = false;
          state.rescueMs = 0;
        }
        return { type, ok: removed.length > 0, removed, freed: removed.length > 0 };
      }
      // The client animates the drop and only then calls spawnBombAt, so the
      // bomb is not on the board (and not edible) while it is falling. With no
      // free cell or the board already at the cap, the bomb is still delivered:
      // it lands on the snake and detonates there.
      const cell = pickBombCell(state);
      if (cell) return { type, ok: true, cell };
      const body = state.snake[Math.floor((state.rand ?? Math.random)() * state.snake.length)];
      const onBody = body || state.snake[0];
      return { type, ok: true, cell: { x: onBody.x, y: onBody.y }, onBody: true };
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

// One step of the body under `d`. Returns null when the move would hit a wall
// or its own body, using exactly the rules `step` applies.
function advance(state, body, d, appleKeys) {
  const next = { x: body[0].x + d.x, y: body[0].y + d.y };
  if (!inBounds(state, next)) return null;
  const eat = appleKeys.has(key(next));
  const rest = eat ? body : body.slice(0, -1);
  for (const s of rest) if (same(s, next)) return null;
  const out = body.slice();
  out.unshift(next);
  if (!eat) out.pop();
  else appleKeys.delete(key(next));
  return out;
}

// Reachability sweep over one body layout. `free` counts the free cells the
// head can still enter (the tail cell counts: it vacates), `open` says the
// whole free space is one connected region, and `tail` says the tail is
// reachable, i.e. the snake can always unwind itself.
function scan(state, body) {
  const w = state.w;
  const h = state.h;
  const n = w * h;
  const blocked = new Uint8Array(n);
  for (let i = 0; i < body.length - 1; i++) blocked[body[i].y * w + body[i].x] = 1;
  const seen = new Uint8Array(n);
  const queue = new Int32Array(n);
  const start = body[0].y * w + body[0].x;
  seen[start] = 1;
  blocked[start] = 1;
  queue[0] = start;
  let head = 0;
  let end = 1;
  let free = 0;

  const visit = (q) => {
    if (seen[q]) return;
    seen[q] = 1;
    if (blocked[q]) return;
    free++;
    queue[end++] = q;
  };

  while (head < end) {
    const p = queue[head++];
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) visit(p - 1);
    if (x < w - 1) visit(p + 1);
    if (y > 0) visit(p - w);
    if (y < h - 1) visit(p + w);
  }

  const tailCell = body[body.length - 1];
  const total = n - body.length + 1;
  return {
    free,
    total,
    open: free >= total,
    tail: seen[tailCell.y * w + tailCell.x] === 1,
  };
}

// The safety gate: the tail must stay reachable and the head must keep real
// room to move, so an accepted move can never close the snake in. Connectivity
// (`open`) is deliberately not required here: one tiny pocket early in a round
// would otherwise veto every apple route for the rest of it.
function isSafe(state, after, margin) {
  const r = scan(state, after);
  return r.tail && r.free >= after.length + margin;
}

// Weakest form of the gate: the tail stays reachable and no free cell is cut
// off. Still excludes every move that starts a pocket the snake cannot unwind
// from, which is what leaves holes the round can never fill.
function keepsTail(state, after) {
  return scan(state, after).tail;
}

// State after walking `path`, or null when any step is illegal. Does not check
// the safety gate; callers do that on the returned body.
function walk(state, body, path) {
  const appleKeys = new Set(state.apples.map(key));
  let cur = body;
  for (const d of path) {
    cur = advance(state, cur, d, appleKeys);
    if (!cur) return null;
  }
  return cur;
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function nearestAppleDistance(p, apples) {
  let best = Infinity;
  for (const a of apples) best = Math.min(best, manhattan(p, a));
  return best;
}

// Every ordered move from the current head. The ordered set is closed under
// taking another ordered move, so each of these is safe on its own.
function orderedMoves(state, cycle, body) {
  const head = body[0];
  const headIdx = cycleIndex(cycle, head);
  if (headIdx < 0) return [];
  const out = [];
  for (const d of DIRS) {
    const target = { x: head.x + d.x, y: head.y + d.y };
    if (!inBounds(state, target)) continue;
    const idx = jumpKeepsOrder(cycle, body, target, !!appleAt(state, target));
    if (idx < 0) continue;
    out.push({ dir: d, idx, delta: (idx - headIdx + cycle.n) % cycle.n });
  }
  return out;
}

// How far ahead along the cycle the closest apple sits.
function cycleDistanceToFood(cycle, fromIdx, apples) {
  let best = cycle.n;
  for (const a of apples) {
    const idx = cycleIndex(cycle, a);
    if (idx < 0) continue;
    const dist = (idx - fromIdx + cycle.n) % cycle.n;
    if (dist < best) best = dist;
  }
  return best;
}

// Emergency net: follow the cycle whenever the body is still ordered along it.
// Only used when no BFS-safe move exists, never as the normal planner.
function cycleSeek(state, cycle, body, rand) {
  if (!cycleOrdered(cycle, body)) return null;
  const moves = orderedMoves(state, cycle, body);
  if (!moves.length) return null;

  for (const m of moves) m.food = cycleDistanceToFood(cycle, m.idx, state.apples);
  moves.sort((a, b) => a.food - b.food || a.delta - b.delta);
  if (moves.length > 1 && rand() < 0.05) {
    return { ...moves[1 + ((rand() * (moves.length - 1)) | 0)].dir };
  }
  return { ...moves[0].dir };
}

function legalMoves(state, body) {
  const head = body[0];
  const appleKeys = new Set(state.apples.map(key));
  const out = [];
  for (const d of DIRS) {
    const c = { x: head.x + d.x, y: head.y + d.y };
    if (!inBounds(state, c)) continue;
    const eat = appleKeys.has(key(c));
    const rest = eat ? body : body.slice(0, -1);
    if (rest.some((s) => same(s, c))) continue;
    out.push({ d, c });
  }
  return out;
}

// How much a route looks dangerous to a viewer: it skims the body, hugs a
// wall, or squeezes through a one-cell corridor. Only presentation: the safety
// gate has already accepted the route before this is scored.
function dangerScore(state, body, path) {
  const w = state.w;
  const h = state.h;
  const blocked = bodySet(body);
  const appleKeys = new Set(state.apples.map(key));
  let cur = body;
  let score = 0;

  for (const d of path) {
    const next = advance(state, cur, d, appleKeys);
    if (!next) break;
    const p = next[0];
    if (p.x === 0 || p.y === 0 || p.x === w - 1 || p.y === h - 1) score += 1;
    let bodyNeighbours = 0;
    let freeNeighbours = 0;
    for (const dd of DIRS) {
      const c = { x: p.x + dd.x, y: p.y + dd.y };
      if (!inBounds(state, c)) continue;
      if (blocked.has(key(c))) bodyNeighbours++;
      else freeNeighbours++;
    }
    if (bodyNeighbours > 0) score += 2;
    if (freeNeighbours <= 1) score += 2;
    cur = next;
    if (appleKeys.has(key(p))) appleKeys.delete(key(p));
    if (path.length > 6) break;
  }
  return score;
}

// A chosen move is a close call when the head ends with a single free exit: a
// tight corridor that reads as a near miss on screen. Presentation only; the
// move has already passed the safety gate.
function isCloseCall(state, after) {
  const head = after[0];
  const blocked = new Set();
  for (let i = 1; i < after.length - 1; i++) blocked.add(key(after[i]));
  let freeNeighbours = 0;
  for (const d of DIRS) {
    const c = { x: head.x + d.x, y: head.y + d.y };
    if (!inBounds(state, c)) continue;
    if (!blocked.has(key(c))) freeNeighbours++;
  }
  return freeNeighbours <= 1;
}

function recentPenalty(state, cell) {
  const recent = state.recent;
  if (!recent || !recent.length) return 0;
  const k = key(cell);
  const at = recent.lastIndexOf(k);
  if (at < 0) return 0;
  return recent.length - at;
}

function remember(state, cell) {
  if (!Array.isArray(state.recent)) state.recent = [];
  state.recent.push(key(cell));
  while (state.recent.length > CONFIG.recentMemory) state.recent.shift();
  if (typeof state.dramaCooldown === 'number' && state.dramaCooldown > 0) state.dramaCooldown--;
  else state.dramaCooldown = 0;
}

function pickRoute(routes, rand) {
  // Shortest route wins; ties are broken by danger so the line stays readable
  // without spending extra route length.
  routes.sort((a, b) => a.len - b.len || b.danger - a.danger);
  const best = routes[0];
  const tied = routes.filter((r) => r.len === best.len);
  return tied[(rand() * tied.length) | 0] || best;
}

// Endgame: with only a handful of free cells left, every remaining cell has to
// be eaten in exactly one order, and the body often has to slide for dozens of
// moves before a hole comes within reach. A bounded depth-first search returns
// a full winning line, or null when the budget runs out. Only a line that
// actually fills the board is accepted, so this can never steer into a trap.
function findWinPlan(state, body, nodeCap = 60000) {
  const n = state.w * state.h;
  const free = n - body.length;
  if (free <= 0) return null;
  let nodes = 0;

  const dfs = (cur, depth) => {
    if (cur.length >= n) return [];
    if (depth <= 0 || ++nodes > nodeCap) return null;
    const appleKeys = new Set(state.apples.map(key));
    // Eating first, then moves that shrink the free space: keeps the search on
    // the winning line instead of sliding in circles.
    const options = [];
    for (const d of DIRS) {
      const next = advance(state, cur, d, new Set(appleKeys));
      if (!next) continue;
      options.push({ d, next, eats: next.length > cur.length });
    }
    options.sort((a, b) => b.eats - a.eats);
    for (const o of options) {
      const rest = dfs(o.next, depth - 1);
      if (rest) return [o.d, ...rest];
    }
    return null;
  };

  return dfs(body, Math.min(240, free * 6 + 24));
}

// Greedy policy used after a slip: shortest route to the nearest food with no
// safety gate, which is how a careless player dies.
function greedySeek(state, body, rand) {
  const moves = legalMoves(state, body);
  if (!moves.length) return null;
  const food = (state.bombs || []).length ? [...state.bombs, ...state.apples] : state.apples;
  const found = shortestPathTo(state, body, food, rand);
  if (found && found.path.length) {
    const d = found.path[0];
    return { dir: d, after: walk(state, body, [d]) };
  }
  let best = null;
  for (const m of moves) {
    const after = walk(state, body, [m.d]);
    if (!after) continue;
    const room = scan(state, after).free;
    if (!best || room > best.room) best = { dir: m.d, after, room };
  }
  return best;
}

// Cycle-safe planner. Every candidate here provably keeps the body ordered
// along the Hamiltonian cycle, so none of them can ever trap the snake and the
// round is guaranteed to fill. Within that safe set the move is chosen by a
// real BFS route to an apple, which is what makes the snake chase directly
// instead of walking the cycle.
function orderedPlanner(state, cycle, body, rand) {
  const head = body[0];
  const headIdx = cycleIndex(cycle, head);
  let baseIdx = headIdx;
  if (baseIdx < 0) {
    for (let i = 1; i < body.length; i++) {
      const idx = cycleIndex(cycle, body[i]);
      if (idx >= 0) {
        baseIdx = idx;
        break;
      }
    }
  }
  if (baseIdx < 0) return null;

  const nextCell = cycle.cells[(baseIdx + 1) % cycle.n];

  // Items first, but only while they are close ahead on the order. Early in a
  // round the snake cuts across for an apple or a bomb; as the body grows the
  // window shrinks, so the closing cells are never stranded behind it. Bombs
  // win ties at the same distance.
  const reach = Math.max(4, 14 - Math.floor(body.length / 12));
  let target = null;
  let best = Infinity;
  for (const item of state.apples) {
    const idx = cycleIndex(cycle, item);
    if (idx < 0) continue;
    const dist = (idx - baseIdx + cycle.n) % cycle.n;
    if (dist === 0 || dist > reach) continue;
    if (dist < best) {
      best = dist;
      target = item;
    }
  }

  if (target) {
    const found = shortestPathTo(state, body, [target], rand);
    if (found && found.path.length) {
      // The first step must also move forward on the order, or the body stops
      // being ordered and the planner falls back to the generic one.
      const first = { x: head.x + found.path[0].x, y: head.y + found.path[0].y };
      const firstIdx = cycleIndex(cycle, first);
      const stepDist = firstIdx < 0 ? Infinity : (firstIdx - baseIdx + cycle.n) % cycle.n;
      const after = walk(state, body, found.path);
      if (stepDist > 0 && stepDist <= reach && after && keepsTail(state, after)) {
        remember(state, after[0]);
        return {
          dir: { ...found.path[0] },
          kind: 'apple',
          closeCall: isCloseCall(state, after),
          gate: true,
          routeLen: found.path.length,
        };
      }
    }
  }

  // Pattern mode: the next order cell, and nothing else. Leaving the order would
  // skip a cell, and a skipped cell can only be reclaimed a full lap later.
  const stepDir = { x: nextCell.x - head.x, y: nextCell.y - head.y };
  if (Math.abs(stepDir.x) + Math.abs(stepDir.y) === 1) {
    const after = walk(state, body, [stepDir]);
    if (after) {
      remember(state, after[0]);
      return {
        dir: stepDir,
        kind: 'pattern',
        closeCall: isCloseCall(state, after),
        gate: true,
        routeLen: 0,
      };
    }
  }

  // The next order cell is refused: take the shortest legal ordered step so the
  // snake keeps moving.
  if (headIdx >= 0) {
    const moves = orderedMoves(state, cycle, body);
    if (moves.length) {
      moves.sort((a, b) => a.delta - b.delta);
      const after = walk(state, body, [moves[0].dir]);
      if (after) {
        remember(state, after[0]);
        return {
          dir: { ...moves[0].dir },
          kind: 'space',
          closeCall: isCloseCall(state, after),
          gate: true,
          routeLen: 0,
        };
      }
    }
  }
  return null;
}

// The planner. Order of business:
//   1. keep only moves that pass the safety gate,
//   2. BFS an apple route and keep it when its end state still passes,
//   3. otherwise take the safe move with the most room and least recent use,
//   4. only when nothing passes the gate, fall back to the cycle or any move.
// Graph distance from a cell to the tail, ignoring the rest of the body. Used
// to stay as far from the tail as possible when no apple is safely reachable:
// that is what keeps the snake filling space instead of curling into a knot.
function tailDistance(state, body, from, tail) {
  const blocked = bodySet(body);
  const start = key(from);
  const goal = key(tail);
  const seen = new Set([start]);
  let frontier = [from];
  let dist = 0;
  while (frontier.length) {
    const next = [];
    for (const p of frontier) {
      if (key(p) === goal) return dist;
      for (const d of DIRS) {
        const c = { x: p.x + d.x, y: p.y + d.y };
        if (!inBounds(state, c)) continue;
        const k = key(c);
        if (seen.has(k)) continue;
        if (blocked.has(k) && k !== goal) continue;
        seen.add(k);
        next.push(c);
      }
    }
    frontier = next;
    dist++;
  }
  return Infinity;
}

// True when `body` still has at least one move the gate would accept. One ply
// of lookahead is what stops the snake stepping into a state that is already
// lost, which a single-state check cannot see.
function hasSafeContinuation(state, body, margin) {
  for (const m of legalMoves(state, body)) {
    const after = walk(state, body, [m.d]);
    if (after && isSafe(state, after, margin)) return true;
  }
  return false;
}

// The planner. Order of business:
//   1. keep only moves that pass the safety gate, and when only one survives,
//      check that it still has a safe continuation,
//   2. BFS an apple route and keep it when its end state still passes,
//   3. otherwise keep as far from the tail as possible while staying safe,
//   4. only when nothing passes the gate, fall back to the cycle or the tail.
export function chooseMoveDetailed(state, rand = Math.random) {
  const body = state.snake;
  if (state.dead || state.won || state.rescuing || !body.length) {
    return { dir: { ...state.dir }, kind: 'idle', closeCall: false, gate: true, routeLen: 0 };
  }

  const moves = legalMoves(state, body);
  if (!moves.length) {
    return { dir: { ...state.dir }, kind: 'stuck', closeCall: false, gate: false, routeLen: 0 };
  }

  // A round can go wrong. One misjudged move makes the snake play greedily for
  // the rest of the round, so it is beatable and the rescue window matters.
  const slip = state.slipChance ?? CONFIG.slipChance;
  if (!state.slipped && rand() < slip) state.slipped = true;
  if (state.slipped) {
    const g = greedySeek(state, body, rand);
    if (g) {
      if (g.after) remember(state, g.after[0]);
      return {
        dir: { ...g.dir },
        kind: 'slip',
        closeCall: g.after ? isCloseCall(state, g.after) : false,
        gate: false,
        routeLen: 0,
      };
    }
  }

  // Primary: cycle-ordered moves are provably trap-free, and BFS routing
  // inside that set still chases apples directly.
  const cycle = fillOrder(state.w, state.h, state.variant || 0);
  if (cycle && cycleOrdered(cycle, body)) {
    const planned = orderedPlanner(state, cycle, body, rand);
    if (planned) return planned;
  }

  const margin = CONFIG.safeMargin;
  const scored = moves.map((m) => {
    const after = walk(state, body, [m.d]);
    return { ...m, after, room: after ? scan(state, after).free : -1 };
  });

  // Two acceptance levels. The full gate keeps a real margin of free cells, and
  // it is what the planner uses while the board has room for it; once the snake
  // is long enough that `length + margin` free cells cannot exist in the region
  // it occupies, the tail rule alone still proves the move is not a dead end.
  let gate = 'full';
  let pool = scored.filter(
    (m) => m.after && isSafe(state, m.after, margin) && scan(state, m.after).open
  );
  if (!pool.length) {
    gate = 'room';
    pool = scored.filter((m) => m.after && isSafe(state, m.after, 0));
  }
  if (!pool.length) {
    gate = 'tail';
    pool = scored.filter((m) => m.after && keepsTail(state, m.after));
  }
  const routeGate = (after) =>
    gate === 'full'
      ? isSafe(state, after, margin) && scan(state, after).open
      : gate === 'room'
        ? isSafe(state, after, 0)
        : keepsTail(state, after);
  const opening = (state.eaten || 0) === 0;

  if (pool.length === 1 && gate === 'full') {
    const deeper = pool.filter((m) => hasSafeContinuation(state, m.after, margin));
    if (deeper.length) pool = deeper;
  }

  const tail = body[body.length - 1];

  if (pool.length) {
    // One route per gate-passing first step: from the post-step head, BFS to
    // the nearest food. Searching per first step (instead of one path per
    // target) is what keeps a safe target reachable when the single shortest
    // path happens to start with a move the gate rejects. Bombs come first.
    const food = (state.bombs || []).length ? [...state.bombs, ...state.apples] : state.apples;
    const routes = [];
    for (const m of pool) {
      const found = shortestPathTo(state, m.after, food, rand);
      // An apple on the very next cell gives an empty tail path, which is a
      // one-step route, not a miss.
      if (!found) continue;
      const path = [m.d, ...found.path];
      const after = walk(state, body, path);
      if (!after) continue;
      if (!routeGate(after)) continue;
      routes.push({
        dir: m.d,
        path,
        len: path.length,
        danger: dangerScore(state, body, path),
        after,
      });
    }

    let chosen = null;
    let kind = 'apple';
    if (routes.length) {
      const best = routes.reduce((a, b) => (b.len < a.len ? b : a));
      const drama = routes.filter(
        (r) => r.danger > best.danger && r.len <= best.len + CONFIG.dramaMaxCost && r.danger > 0
      );
      const canDrama =
        drama.length > 0 &&
        rand() < CONFIG.dramaChance &&
        (state.dramaCooldown || 0) <= 0 &&
        !opening;
      if (canDrama) {
        chosen = drama[(rand() * drama.length) | 0];
        kind = 'drama';
        state.dramaCooldown = CONFIG.dramaCooldown;
      } else {
        chosen = pickRoute(routes, rand);
      }
    } else {
      // No safe apple route. Late in the round the last free cells are usually
      // holes in the body and only a real search can order them.
      const freeCells = state.w * state.h - body.length;
      const plan = freeCells <= 14 ? findWinPlan(state, body) : null;
      if (plan && plan.length) {
        // A verified winning line, not a gate-scored guess.
        const after = walk(state, body, [plan[0]]);
        kind = 'finish';
        chosen = { dir: plan[0], after: after || pool[0].after };
      } else {
        // Hold the most space by keeping away from the tail, then drift toward
        // the nearest apple, then avoid re-treading cells.
        kind = 'space';
        for (const m of pool) m.far = opening ? 0 : tailDistance(state, body, m.c, tail);
        pool.sort(
          (a, b) =>
            b.room - a.room ||
            b.far - a.far ||
            nearestAppleDistance(a.c, food) - nearestAppleDistance(b.c, food) ||
            recentPenalty(state, a.c) - recentPenalty(state, b.c) ||
            rand() - 0.5
        );
        chosen = { dir: pool[0].d, after: pool[0].after };
      }
    }

    if (!chosen) {
      kind = 'space';
      chosen = { dir: pool[0].d, after: pool[0].after };
    }

    const closeCall = chosen.after ? isCloseCall(state, chosen.after) : false;
    remember(state, chosen.after ? chosen.after[0] : pool[0].c);
    return {
      dir: { ...chosen.dir },
      kind,
      closeCall,
      gate: gate !== 'none',
      routeLen: chosen.path ? chosen.path.length : 0,
    };
  }

  // Nothing passes the safety gate. Survivors below, in order: the cycle net,
  // the tail, then the move that keeps the most room. Never taken while the
  // round is opening, so the first apple still reads as a direct chase.
  if (!opening) {
    const cycle = fillOrder(state.w, state.h, state.variant || 0);
    if (cycle) {
      const move = cycleSeek(state, cycle, body, rand);
      if (move) {
        const after = walk(state, body, [move]);
        remember(state, after ? after[0] : body[0]);
        return { dir: move, kind: 'cycle', closeCall: false, gate: false, routeLen: 0 };
      }
    }

    const toTail = shortestPathTo(state, body, [tail], rand);
    if (toTail && toTail.path.length) {
      const after = walk(state, body, [toTail.path[0]]);
      if (after) {
        remember(state, after[0]);
        return {
          dir: { ...toTail.path[0] },
          kind: 'tail',
          closeCall: isCloseCall(state, after),
          gate: false,
          routeLen: toTail.path.length,
        };
      }
    }
  }

  const options = scored.filter((m) => m.after);
  if (!options.length) {
    return { dir: { ...state.dir }, kind: 'stuck', closeCall: false, gate: false, routeLen: 0 };
  }
  options.sort((a, b) => b.room - a.room || rand() - 0.5);
  remember(state, options[0].after[0]);
  return {
    dir: { ...options[0].d },
    kind: 'desperate',
    closeCall: isCloseCall(state, options[0].after),
    gate: false,
    routeLen: 0,
  };
}

export function chooseMove(state, rand = Math.random) {
  return chooseMoveDetailed(state, rand).dir;
}
