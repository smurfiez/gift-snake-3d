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
  // Planner tuning. The margin is the number of free cells the head must keep
  // beyond the snake's own length before a move counts as safe.
  safeMargin: 4,
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

  const ids = new Int32Array(w * h).fill(-1);
  for (let i = 0; i < cells.length; i++) ids[cells[i].y * w + cells[i].x] = i;
  const cycle = { cells, ids, w, h, n: cells.length };
  cycleCache.set(ck, cycle);
  return cycle;
}

function cycleIndex(cycle, p) {
  if (p.x < 0 || p.y < 0 || p.x >= cycle.w || p.y >= cycle.h) return -1;
  return cycle.ids[p.y * cycle.w + p.x];
}

// The body is ordered when, read head to tail, each segment sits strictly
// further behind the head along the cycle. While that holds the cell after the
// head on the cycle can never be part of the body, so the snake can keep
// moving around the cycle forever without ever meeting itself.
function cycleOrdered(cycle, body) {
  const headIdx = cycleIndex(cycle, body[0]);
  if (headIdx < 0) return false;
  let prev = 0;
  for (let i = 1; i < body.length; i++) {
    const idx = cycleIndex(cycle, body[i]);
    if (idx < 0) return false;
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
    if (idx < 0) return -1;
    const behind = (targetIdx - idx + cycle.n) % cycle.n;
    if (behind <= prev) return -1;
    prev = behind;
  }
  return targetIdx;
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
  if (apple) {
    state.apples.splice(state.apples.indexOf(apple), 1);
    state.eaten = (state.eaten || 0) + 1;
  } else state.snake.pop();

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

// Cycle-safe planner. Every candidate here provably keeps the body ordered
// along the Hamiltonian cycle, so none of them can ever trap the snake and the
// round is guaranteed to fill. Within that safe set the move is chosen by a
// real BFS route to an apple, which is what makes the snake chase directly
// instead of walking the cycle.
function orderedPlanner(state, cycle, body, rand) {
  const moves = orderedMoves(state, cycle, body);
  if (!moves.length) return null;
  const opening = (state.eaten || 0) === 0;

  // Escape hatch. A direct route can be startable only by a move the ordered
  // set forbids, and the head then loops without eating. Plain cycle steps
  // always progress, so walk them until an apple is taken.
  if ((state.cycleMode || 0) > 0) {
    state.cycleMode--;
    moves.sort((a, b) => a.delta - b.delta);
    const step = moves[0];
    const after = walk(state, body, [step.dir]);
    if (!after) return null;
    remember(state, after[0]);
    return {
      dir: { ...step.dir },
      kind: 'space',
      closeCall: isCloseCall(state, after),
      gate: true,
      routeLen: 0,
    };
  }

  // Commit to one apple until it is eaten or out of reach. Without this the
  // snake swaps targets every tick and orbits between two equally near apples.
  const target =
    state.target && state.apples.some((a) => same(a, state.target)) ? state.target : null;
  const goals = target ? [state.target] : state.apples;

  const routes = [];
  for (const m of moves) {
    const after = walk(state, body, [m.dir]);
    const found = after ? shortestPathTo(state, after, goals, rand) : null;
    const path = found ? [m.dir, ...found.path] : [m.dir];
    routes.push({
      dir: m.dir,
      delta: m.delta,
      path,
      len: found ? 1 + found.path.length : Infinity,
      danger: found ? dangerScore(state, body, path) : 0,
      target: found ? found.target : null,
      after,
    });
  }

  const reachable = routes.filter((r) => Number.isFinite(r.len));
  if (!reachable.length && target) {
    state.target = null;
    return orderedPlanner(state, cycle, body, rand);
  }

  // The committed apple can be reachable only by a route the ordered move set
  // cannot start, which shows up as a route length that never shrinks while the
  // head loops. After a few of those, drop the route and walk the cycle, which
  // visits every cell and therefore reaches the apple anyway.
  if (reachable.length) {
    const shortest = reachable.reduce((a, b) => Math.min(a, b.len), Infinity);
    if (state.bestLen == null || shortest < state.bestLen) {
      // Real progress. A see-saw that returns to the same length is not.
      state.bestLen = shortest;
      state.stuck = 0;
    } else {
      state.stuck = (state.stuck || 0) + 1;
    }
    if (state.stuck > 8) {
      state.stuck = 0;
      state.bestLen = null;
      state.target = null;
      state.cycleMode = 220;
    }
  }
  let chosen = null;
  let kind = 'apple';

  if (reachable.length) {
    reachable.sort((a, b) => a.len - b.len || a.delta - b.delta);
    const best = reachable[0];
    const drama = reachable.filter(
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
      chosen = best;
    }
    state.target = chosen.target || null;
    if (!state.target) state.bestLen = null;
  } else {
    // No apple is reachable by a direct BFS route, which is normal once the
    // body itself walls off the board. Fall back to cycle discipline: move to
    // the ordered cell that sits closest to an apple along the cycle, which is
    // what keeps the snake filling the board instead of circling.
    kind = 'space';
    const fresh = moves.filter((m) => thingFresh(state, m.dir, body));
    const pool = fresh.length ? fresh : moves;
    for (const m of pool) m.food = cycleDistanceToFood(cycle, m.idx, state.apples);
    pool.sort((a, b) => a.food - b.food || a.delta - b.delta);
    const pick = pool[0];
    chosen = {
      dir: pick.dir,
      delta: pick.delta,
      path: [pick.dir],
      len: 0,
      danger: 0,
      after: walk(state, body, [pick.dir]),
      head: { x: body[0].x + pick.dir.x, y: body[0].y + pick.dir.y },
    };
  }

  if (!chosen || !chosen.after) return null;
  const closeCall = isCloseCall(state, chosen.after);
  remember(state, chosen.after[0]);
  return {
    dir: { ...chosen.dir },
    kind,
    closeCall,
    gate: true,
    routeLen: Number.isFinite(chosen.len) ? chosen.len : 0,
  };
}

// A move that does not revisit a cell the head just left; keeps the snake from
// replaying the same two-cell oscillation when nothing is reachable.
function thingFresh(state, dir, body) {
  const cell = { x: body[0].x + dir.x, y: body[0].y + dir.y };
  return recentPenalty(state, cell) === 0;
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

  // Primary: cycle-ordered moves are provably trap-free, and BFS routing
  // inside that set still chases apples directly.
  const cycle = hamiltonCycle(state.w, state.h);
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
    // the nearest apple. Searching per first step (instead of one path per
    // apple) is what keeps a safe apple reachable when the single shortest
    // path happens to start with a move the gate rejects.
    const routes = [];
    for (const m of pool) {
      const found = shortestPathTo(state, m.after, state.apples, rand);
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
        const after = walk(state, body, [plan[0]]);
        const gated = !!after && pool.some((m) => key(m.c) === key(after[0]));
        chosen = { dir: plan[0], after: after || pool[0].after };
        if (!gated) gate = 'none';
      } else {
        // Hold the most space by keeping away from the tail, then drift toward
        // the nearest apple, then avoid re-treading cells.
        kind = 'space';
        for (const m of pool) m.far = opening ? 0 : tailDistance(state, body, m.c, tail);
        pool.sort(
          (a, b) =>
            b.room - a.room ||
            b.far - a.far ||
            nearestAppleDistance(a.c, state.apples) -
              nearestAppleDistance(b.c, state.apples) ||
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
    const cycle = hamiltonCycle(state.w, state.h);
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
