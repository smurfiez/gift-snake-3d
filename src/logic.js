export const CONFIG = Object.freeze({
  startLength: 3,
  minLength: 3,
  boardW: 16,
  boardH: 17,
  // Board growth stops here. Width stays even, so the serpentine fallback can
  // always close a grown board.
  maxBoardW: 24,
  maxBoardH: 25,
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
  rescueMs: 5000,
  restartMs: 3000,
  // After the board fills, the snake keeps moving for this long before the win
  // is awarded, so the round ends on a visible victory lap instead of a freeze.
  winDelayMs: 10000,
  // Planner tuning. The margin is the number of free cells the head must keep
  // beyond the snake's own length before a move counts as safe.
  safeMargin: 4,
  // How far ahead on the fill order the snake will cut across for an item.
  // Skipped cells are reclaimed on a later lap, so this is a pacing knob.
  chaseReach: 14,
  // How much the window shrinks per cell of body length.
  chaseFalloff: 12,
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

// Growth comes in whole columns or rows and never changes the width parity, so
// a grown board always has one even side.
const BOARD_GROW = 2;

const key = (p) => `${p.x},${p.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;

const cycleCache = new Map();

// Concentric-ring Hamiltonian cycle for a rectangular region. Rings are peeled
// from the outside in, each ring walking its perimeter except for one seam cell
// on row S; the growing body therefore draws nested concentric loops instead of
// stripes. When `exact` is true, requires H === W + 1 (the classic square-ish
// single bullseye); otherwise closes any rectangle where one side is even (W >= 4)
// and the other side is at least W + 1, with an optional seam shift.
function subRingCycle(w, h, seamShift = 0, exact = false) {
  let W = w;
  let H = h;
  let transposed = false;
  if (w % 2 === 0 && (exact ? h === w + 1 : h >= w + 1)) {
    W = w;
    H = h;
  } else if (h % 2 === 0 && (exact ? w === h + 1 : w >= h + 1)) {
    W = h;
    H = w;
    transposed = true;
  } else {
    return null;
  }
  if (W < 4) return null;

  const R = W / 2;
  const minS = R;
  const maxS = H - 1 - R;
  const span = maxS - minS + 1;
  const S = minS + ((((Math.floor(span / 2) + seamShift) % span) + span) % span);
  const path = [];

  for (let r = 0; r < R; r++) {
    const x0 = r;
    const x1 = W - 1 - r;
    const y0 = r;
    const y1 = H - 1 - r;
    const ring = [];
    for (let y = S - 1; y >= y0; y--) ring.push({ x: x0, y });
    for (let x = x0 + 1; x <= x1; x++) ring.push({ x, y: y0 });
    for (let y = y0 + 1; y <= y1; y++) ring.push({ x: x1, y });
    for (let x = x1 - 1; x >= x0; x--) ring.push({ x, y: y1 });
    for (let y = y1 - 1; y >= S + 1; y--) ring.push({ x: x0, y });
    if (r % 2 === 1) ring.reverse();
    for (const c of ring) path.push(c);
  }

  for (let x = R - 1; x >= 0; x--) {
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

function ringCycle(w, h) {
  return subRingCycle(w, h, 0, true);
}

function offsetCells(cells, dx, dy) {
  return cells ? cells.map((c) => ({ x: c.x + dx, y: c.y + dy })) : null;
}

// Stitches two disjoint Hamiltonian cycles that share a boundary into a single
// closed Hamiltonian cycle covering both regions.
function stitchCycles(cycleA, cycleB, pickHint = 0) {
  if (!cycleA || !cycleB) return null;
  const nA = cycleA.length;
  const nB = cycleB.length;
  const bMap = new Map();
  for (let j = 0; j < nB; j++) bMap.set(`${cycleB[j].x},${cycleB[j].y}`, j);

  const bridges = [];
  for (let i = 0; i < nA; i++) {
    const a1 = cycleA[i];
    const a2 = cycleA[(i + 1) % nA];
    for (const d of DIRS) {
      const j = bMap.get(`${a1.x + d.x},${a1.y + d.y}`);
      if (j === undefined) continue;
      const bNext = cycleB[(j + 1) % nB];
      if (Math.abs(a2.x - bNext.x) + Math.abs(a2.y - bNext.y) === 1) {
        bridges.push({ i, j, dir: -1 });
      }
      const bPrev = cycleB[(j - 1 + nB) % nB];
      if (Math.abs(a2.x - bPrev.x) + Math.abs(a2.y - bPrev.y) === 1) {
        bridges.push({ i, j, dir: 1 });
      }
    }
  }
  if (!bridges.length) return null;

  const br = bridges[((pickHint % bridges.length) + bridges.length) % bridges.length];
  const out = cycleA.slice(0, br.i + 1);
  for (let k = 0; k < nB; k++) out.push(cycleB[(br.j + k * br.dir + nB) % nB]);
  for (let k = br.i + 1; k < nA; k++) out.push(cycleA[k]);
  return out;
}

// Twin concentric circles: two concentric-ring hubs (either horizontal stacked
// or vertical side-by-side) stitched into a figure-8 or twin-spiral cycle.
function twinRingCycle(w, h, mod = 0) {
  if ((mod & 4) !== 0 && h >= 12 && w % 2 === 0) {
    const h1 = mod & 1 && h - 8 >= 6 ? 8 : 6;
    const h2 = h - h1;
    const top = subRingCycle(w, h1, mod);
    const bot = offsetCells(subRingCycle(w, h2, -mod), 0, h1);
    if (top && bot) {
      if (mod & 2) bot.reverse();
      const stitched = stitchCycles(top, bot, mod * 3 + 1);
      if (stitched) return stitched;
    }
  }
  if (w % 2 === 0 && w >= 8) {
    const half = 2 * Math.floor(w / 4);
    const w1 = mod & 1 && half >= 6 && w - (half - 2) <= h - 1 ? half - 2 : half;
    const w2 = w - w1;
    if (w1 >= 4 && w2 >= 4 && h >= Math.max(w1, w2) + 1) {
      const c1 = subRingCycle(w1, h, mod - 1);
      const c2 = offsetCells(subRingCycle(w2, h, 1 - mod), w1, 0);
      if (c1 && c2) {
        if (mod & 2) c2.reverse();
        const stitched = stitchCycles(c1, c2, mod * 3 + 1);
        if (stitched) return stitched;
      }
    }
  }
  return subRingCycle(w, h, mod);
}

// Triple concentric circles: either a wide top concentric coil over two bottom
// concentric coils, or three side-by-side concentric circle hubs.
function tripleRingCycle(w, h, mod = 0) {
  const hTop = 6;
  const hBot = h - hTop;
  if ((mod & 1) === 0 && w >= 12 && hBot >= 7) {
    const w1 = 2 * Math.floor(w / 4);
    const w2 = w - w1;
    if (hBot >= Math.max(w1, w2) + 1) {
      const top = subRingCycle(w, hTop, mod);
      const bl = offsetCells(subRingCycle(w1, hBot, mod), 0, hTop);
      const br = offsetCells(subRingCycle(w2, hBot, -mod), w1, hTop);
      if (top && bl && br) {
        if (mod & 2) br.reverse();
        const bot = stitchCycles(bl, br, mod + 2);
        const all = stitchCycles(top, bot, mod * 5 + 3);
        if (all) return all;
      }
    }
  }
  if (w % 2 === 0 && w >= 14) {
    const w1 = 2 * Math.floor(w / 6);
    const w3 = w1;
    const w2 = w - w1 - w3;
    if (w1 >= 4 && w2 >= 4 && h >= Math.max(w1, w2) + 1) {
      const c1 = subRingCycle(w1, h, mod);
      const c2 = offsetCells(subRingCycle(w2, h, -mod), w1, 0);
      const c3 = offsetCells(subRingCycle(w3, h, mod + 1), w1 + w2, 0);
      if (c1 && c2 && c3) {
        if (mod & 2) c2.reverse();
        const all = stitchCycles(stitchCycles(c1, c2, mod + 1), c3, mod + 3);
        if (all) return all;
      }
    }
  }
  return twinRingCycle(w, h, mod);
}

// Quad concentric circles: four independent concentric-ring bullseyes arranged
// across the four quadrants of the board.
function quadRingCycle(w, h, mod = 0) {
  const w1 = 2 * Math.floor(w / 4);
  const w2 = w - w1;
  const hEven = h - 8 >= Math.max(w1, w2) + 1 ? 8 : 6;
  const hOdd = h - hEven;
  const wA = hEven - 2;
  const wB = w - wA;
  if (wA >= 4 && wB >= hEven + 1 && w1 >= 4 && hOdd >= Math.max(w1, w2) + 1) {
    const tl = subRingCycle(w1, hOdd, mod);
    const tr = offsetCells(subRingCycle(w2, hOdd, -mod), w1, 0);
    const bl = offsetCells(subRingCycle(wA, hEven, mod), 0, hOdd);
    const br = offsetCells(subRingCycle(wB, hEven, -mod), wA, hOdd);
    if (tl && tr && bl && br) {
      if (mod & 1) tr.reverse();
      if (mod & 2) bl.reverse();
      const top = stitchCycles(tl, tr, mod + 1);
      const bot = stitchCycles(bl, br, mod + 2);
      const all = stitchCycles(top, bot, mod * 3 + 2);
      if (all) return all;
    }
  }
  if (w % 2 === 0 && w >= 16) {
    const cW = [4, 4, 4, 4];
    let rem = w - 16;
    let k = 0;
    while (rem >= 2) {
      cW[k % 4] += 2;
      rem -= 2;
      k++;
    }
    if (h >= Math.max(...cW) + 1) {
      let x = 0;
      let acc = null;
      for (let i = 0; i < 4; i++) {
        const sub = offsetCells(subRingCycle(cW[i], h, i + mod), x, 0);
        acc = i === 0 ? sub : stitchCycles(acc, sub, i + mod);
        x += cW[i];
      }
      if (acc) return acc;
    }
  }
  return tripleRingCycle(w, h, mod);
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

// Family = which concentric-circle topology:
//   0: single full-board concentric bullseye
//   1: twin side-by-side / figure-8 concentric circles
//   2: triple concentric circle hubs
//   3: quad quadrant concentric circle bullseyes
function patternCells(w, h, family, mod = 0) {
  if (family === 0) return subRingCycle(w, h, mod, true);
  if (family === 1) {
    if (!ringCycle(w, h) && !ringCycle(h, w)) return null;
    return twinRingCycle(w, h, mod);
  }
  if (family === 2) return tripleRingCycle(w, h, mod) || serpentineCells(w, h);
  return (
    quadRingCycle(w, h, mod) ||
    (() => {
      const cells = serpentineCells(h, w);
      return cells && cells.map((c) => ({ x: c.y, y: c.x }));
    })()
  );
}

// The order the body grows along, cached per board size and pattern. Bits 0-1
// pick the concentric-circle family, 2-4 apply a mirror, reverse, or hub shift
// so the snake builds varied single and multi-circle formations.
export function fillOrder(w, h, variant = 0) {
  const v = ((variant % FILL_PATTERNS) + FILL_PATTERNS) % FILL_PATTERNS;
  const ck = `${w}x${h}:${v}`;
  if (cycleCache.has(ck)) return cycleCache.get(ck);

  let cells = patternCells(w, h, v & 3, v >> 2);
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

let lastLiveVariant = -1;

// Optional `size` is the session board size, so a gifted growth still applies
// after the round restart. Without it the configured board is used.
export function createState(rand = Math.random, size = null) {
  const w = (size && size.w) || CONFIG.boardW;
  const h = (size && size.h) || CONFIG.boardH;
  // Pick across all four concentric-circle families (single, twin, triple, quad)
  // with random mirror/reverse bits so every round starts with a fresh layout.
  const family = Math.floor(rand() * 4);
  let variant = family | (Math.floor(rand() * 8) << 2);
  if (rand === Math.random && variant === lastLiveVariant) {
    variant = (variant + 1 + Math.floor(rand() * 7) * 4) & 31;
  }
  let cycle = fillOrder(w, h, variant);
  // A grown board where H !== W + 1 uses the multi-circle families (2 or 3),
  // which close on every board with at least one even side.
  if (!cycle) {
    variant = (2 + (variant & 1)) | (variant & 28);
    cycle = fillOrder(w, h, variant);
  }
  if (rand === Math.random) lastLiveVariant = variant;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;

  const n = cycle.n;
  const candidates = [];
  for (let i = 0; i < n; i++) {
    const c0 = cycle.cells[i];
    const next = cycle.cells[(i + 1) % n];
    const dir = { x: next.x - c0.x, y: next.y - c0.y };
    let ok = true;
    for (let k = 0; k < CONFIG.startLength; k++) {
      const ck = cycle.cells[(i - k + n * 2) % n];
      if (ck.x < 2 || ck.x > w - 3 || ck.y < 2 || ck.y > h - 3) {
        ok = false;
        break;
      }
      if (k >= 1) {
        const onRayX = (ck.x - c0.x) * dir.x > 0 && ck.y === c0.y;
        const onRayY = (ck.y - c0.y) * dir.y > 0 && ck.x === c0.x;
        if (onRayX || onRayY) {
          ok = false;
          break;
        }
      }
    }
    if (ok) candidates.push(i);
  }

  let headIdx;
  if (candidates.length > 0) {
    headIdx = candidates[Math.floor(rand() * candidates.length)];
  } else {
    headIdx = 0;
    let best = Infinity;
    for (let i = 0; i < cycle.n; i++) {
      const d = Math.abs(cycle.cells[i].x - cx) + Math.abs(cycle.cells[i].y - cy);
      if (d < best) {
        best = d;
        headIdx = i;
      }
    }
  }

  // Start on the cycle so every later cycle step is collision-free.
  const snake = [];
  for (let i = 0; i < CONFIG.startLength; i++) {
    const c = cycle.cells[(headIdx - i + n * 2) % n];
    snake.push({ x: c.x, y: c.y });
  }
  const next = cycle.cells[(headIdx + 1) % n];
  const dir = { x: next.x - snake[0].x, y: next.y - snake[0].y };

  const chordModes = ['tight', 'deep', 'mixed'];
  const style = {
    coilEvery: 3 + Math.floor(rand() * 5),
    chordMode: chordModes[Math.floor(rand() * chordModes.length)],
    shortcutGrid: 5 + Math.floor(rand() * 4),
    straightBias: 0.55 + rand() * 0.35,
    shiftEvery: 2 + Math.floor(rand() * 3),
  };

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
    coilSteps: 0,
    lastShiftEaten: 0,
    patternShifts: 0,
    style,
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

// Any empty cell, or null on a full board.
export function freeCellFor(state) {
  const rand = state.rand ?? Math.random;
  const free = freeCells(state);
  return free.length ? free[Math.floor(rand() * free.length)] : null;
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
    // Grow, but never past the cells the board has: a victory-lap apple tops the
    // snake back up to a full board instead of pushing it over.
    if (state.snake.length > state.w * state.h) state.snake.pop();
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

// A grown board still needs a fill order: rings close on one shape, serpentine
// on any board with one even side.
function boardFits(w, h) {
  return !!fillOrder(w, h, 0) || !!fillOrder(w, h, 2);
}

// Board growth is a session setting, not a per-round gift: the body order
// belongs to the old board, so the caller restarts the round at the returned
// size. At the cap the board is left untouched.
function growBoard(state, type) {
  const w = type === 'widen' ? Math.min(CONFIG.maxBoardW, state.w + BOARD_GROW) : state.w;
  const h = type === 'taller' ? Math.min(CONFIG.maxBoardH, state.h + BOARD_GROW) : state.h;
  const grows = w > state.w || h > state.h;
  const ok = grows && !state.dead && !state.won && !state.rescuing && boardFits(w, h);
  if (ok) {
    state.w = w;
    state.h = h;
  }
  return { type, ok, w: state.w, h: state.h };
}

export function applyGift(state, type) {
  if (type === 'widen' || type === 'taller') return growBoard(state, type);
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

// BFS to `target` where every step advances monotonically along `cycle` toward
// `target`. Guarantees that a shortcut never overshoots the item on the cycle
// and never starts a route whose second step would be rejected as out-of-order.
function orderedPathTo(state, cycle, body, baseIdx, target, targetDist, rand = Math.random) {
  if (!body.length || !target) return null;
  const head = body[0];
  const blocked = bodySet(body);
  const goalKey = key(target);
  const visited = new Set([key(head)]);
  const queue = [{ p: head, path: [], progress: 0 }];

  while (queue.length) {
    const cur = queue.shift();
    if (key(cur.p) === goalKey) return { path: cur.path, target: cur.p };
    const next = neighborList(state, blocked, cur.p, visited);
    for (let i = next.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [next[i], next[j]] = [next[j], next[i]];
    }
    const curDir = cur.path.length ? cur.path[cur.path.length - 1] : state.lastMove;
    if (curDir && next.length > 1) {
      const straightIdx = next.findIndex((n) => same(n.d, curDir));
      if (straightIdx > 0 && rand() < (state.style ? state.style.straightBias : 0.85)) {
        const [straight] = next.splice(straightIdx, 1);
        next.unshift(straight);
      }
    }
    for (const n of next) {
      if (cur.path.length === 0) {
        if (jumpKeepsOrder(cycle, body, n.c, !!appleAt(state, n.c)) < 0) continue;
      }
      const nIdx = cycleIndex(cycle, n.c);
      if (nIdx < 0) continue;
      const prog = (nIdx - baseIdx + cycle.n) % cycle.n;
      if (prog <= cur.progress || prog > targetDist) continue;
      visited.add(n.k);
      queue.push({ p: n.c, path: cur.path.concat(n.d), progress: prog });
    }
  }
  return null;
}

// BFS to the nearest cell in `goals`. The tail cell counts as free because it
// vacates when the head advances. Prefers continuing in the current movement
// direction before turning so routes read as smooth human L-turns and arcs
// instead of jagged stair-steps.
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
    const curDir = cur.path.length ? cur.path[cur.path.length - 1] : state.lastMove;
    if (curDir && next.length > 1) {
      const straightIdx = next.findIndex((n) => same(n.d, curDir));
      if (straightIdx > 0 && rand() < (state.style ? state.style.straightBias : 0.85)) {
        const [straight] = next.splice(straightIdx, 1);
        next.unshift(straight);
      }
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

// Dynamically shifts to a different concentric-circle variant mid-round when
// the current body sits cleanly along a shared arc of the new pattern, so the
// snake transitions between single, twin, triple and quad concentric circles
// without ever breaking the cycle-ordered invariant.
function maybeShiftPattern(state, cycle, body, rand) {
  const eaten = state.eaten || 0;
  const shiftEvery = (state.style && state.style.shiftEvery) || 3;
  if (eaten <= 0 || eaten - (state.lastShiftEaten || 0) < shiftEvery) return cycle;
  if (body.length >= cycle.n * 0.55) return cycle;
  if (rand() >= 0.65) return cycle;

  const curV = state.variant || 0;
  const start = (rand() * FILL_PATTERNS) | 0;
  for (let k = 0; k < FILL_PATTERNS; k++) {
    const v = (start + k) % FILL_PATTERNS;
    if (v === curV || (v & 3) === (curV & 3)) continue;
    const cand = fillOrder(state.w, state.h, v);
    if (!cand || !cycleOrdered(cand, body)) continue;
    const hIdx = cycleIndex(cand, body[0]);
    if (hIdx < 0) continue;
    const next = cand.cells[(hIdx + 1) % cand.n];
    if (Math.abs(next.x - body[0].x) + Math.abs(next.y - body[0].y) !== 1) continue;
    if (!walk(state, body, [{ x: next.x - body[0].x, y: next.y - body[0].y }])) continue;
    state.variant = v;
    state.lastShiftEaten = eaten;
    state.patternShifts = (state.patternShifts || 0) + 1;
    return cand;
  }
  return cycle;
}

// Cycle-safe planner. Every candidate here provably keeps the body ordered
// along the Hamiltonian cycle, so none of them can ever trap the snake and the
// round is guaranteed to fill. Within that safe set the move is chosen by a
// smooth BFS route to an apple or a tight concentric-ring chord jump, which is
// what makes the snake play like a human and coil into multiple concentric
// circles instead of marching along one fixed track.
function orderedPlanner(state, baseCycle, body, rand) {
  const cycle = maybeShiftPattern(state, baseCycle, body, rand);
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

  let tailIdx = baseIdx;
  for (let i = body.length - 1; i >= 0; i--) {
    const idx = cycleIndex(cycle, body[i]);
    if (idx >= 0) {
      tailIdx = idx;
      break;
    }
  }
  const freeSpan = body.length <= 1 ? cycle.n - 1 : (tailIdx - baseIdx - 1 + cycle.n) % cycle.n;

  const nextCell = cycle.cells[(baseIdx + 1) % cycle.n];

  // Items first: any item inside the close window ahead on the order, or any
  // physically close item across an adjacent concentric ring that can be reached
  // with a safe forward shortcut without jumping over the tail.
  const baseReach = Math.max(4, CONFIG.chaseReach - Math.floor(body.length / CONFIG.chaseFalloff));
  const reserve = Math.min(cycle.n - 4, Math.floor(body.length * 1.15) + CONFIG.safeMargin);
  const maxReach = Math.max(
    baseReach,
    Math.min(Math.max(0, freeSpan - reserve), Math.floor(cycle.n * 0.65))
  );
  const bombs = state.bombs || [];
  const allItems = bombs.length ? [...bombs, ...state.apples] : state.apples;
  let target = null;
  let best = Infinity;
  const shortcutGrid = (state.style && state.style.shortcutGrid) || 6;
  for (const item of allItems) {
    const idx = cycleIndex(cycle, item);
    if (idx < 0) continue;
    const dist = (idx - baseIdx + cycle.n) % cycle.n;
    if (dist === 0) continue;
    const gridDist = manhattan(head, item);
    const inBase = dist <= baseReach;
    const inShortcut =
      (state.eaten || 0) > 0 && dist <= maxReach && gridDist <= shortcutGrid && dist >= gridDist * 2;
    if (!inBase && !inShortcut) continue;
    const isBomb = bombs.includes(item);
    const score = (inBase ? dist : gridDist * 2 + dist * 0.1) - (isBomb ? 0.5 : 0);
    if (score < best) {
      best = score;
      target = item;
    }
  }

  // Tight concentric coiling: after tracing a stretch of the current ring, step
  // inward across rings or close a tighter concentric loop around the hub center
  // whenever the inner rings have ample room for the snake's current length and
  // no item is skipped on the outer arc.
  const coilEvery = (state.style && state.style.coilEvery) || 5;
  const tryCoilingChord = () => {
    if (
      (state.eaten || 0) > 0 &&
      headIdx >= 0 &&
      body.length < cycle.n * 0.72 &&
      (state.coilSteps || 0) >= coilEvery
    ) {
      const minLoop = Math.max(body.length + 14, 34);
      const chords = orderedMoves(state, cycle, body).filter((m) => {
        if (m.delta < 4 || m.delta > Math.floor(cycle.n * 0.45)) return false;
        const freeAfter = (tailIdx - m.idx - 1 + cycle.n) % cycle.n;
        if (freeAfter < minLoop) return false;
        for (const it of allItems) {
          const itIdx = cycleIndex(cycle, it);
          if (itIdx < 0) continue;
          const dIt = (itIdx - baseIdx + cycle.n) % cycle.n;
          if (dIt > 0 && dIt < m.delta) return false;
        }
        return true;
      });
      if (chords.length && rand() < 0.65) {
        chords.sort((a, b) => a.delta - b.delta);
        let pick;
        if (state.style && state.style.chordMode === 'deep') {
          pick = chords[chords.length - 1];
        } else if (state.style && state.style.chordMode === 'mixed') {
          pick = chords[(rand() * chords.length) | 0];
        } else {
          pick = chords[0];
        }
        const after = walk(state, body, [pick.dir]);
        if (after && keepsTail(state, after)) {
          state.coilSteps = 0;
          remember(state, after[0]);
          return {
            dir: { ...pick.dir },
            kind: 'pattern',
            closeCall: isCloseCall(state, after),
            gate: true,
            routeLen: 0,
          };
        }
      }
    }
    return null;
  };

  if (target) {
    const targetIdx = cycleIndex(cycle, target);
    const targetDist = (targetIdx - baseIdx + cycle.n) % cycle.n;
    const found = orderedPathTo(state, cycle, body, baseIdx, target, targetDist, rand);
    if (found && found.path.length) {
      const after = walk(state, body, found.path);
      if (after && keepsTail(state, after)) {
        if (!same(after[0], nextCell)) {
          state.coilSteps = 0;
          remember(state, after[0]);
          return {
            dir: { ...found.path[0] },
            kind: bombs.includes(target) ? 'bomb' : 'apple',
            closeCall: isCloseCall(state, after),
            gate: true,
            routeLen: found.path.length,
          };
        }
        if (targetDist >= 4 && manhattan(head, target) > 1) {
          const chordMove = tryCoilingChord();
          if (chordMove) return chordMove;
        }
        state.coilSteps = (state.coilSteps || 0) + 1;
        remember(state, after[0]);
        return {
          dir: { ...found.path[0] },
          kind: bombs.includes(target) ? 'bomb' : 'apple',
          closeCall: isCloseCall(state, after),
          gate: true,
          routeLen: found.path.length,
        };
      }
    }
  }

  const chordMove = tryCoilingChord();
  if (chordMove) return chordMove;

  // Pattern mode: advance along the current concentric circle path.
  const stepDir = { x: nextCell.x - head.x, y: nextCell.y - head.y };
  if (Math.abs(stepDir.x) + Math.abs(stepDir.y) === 1) {
    const after = walk(state, body, [stepDir]);
    if (after) {
      state.coilSteps = (state.coilSteps || 0) + 1;
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
