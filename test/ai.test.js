import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  createState,
  step,
  chooseMoveDetailed,
  spawnApple,
  appleAt,
  fillOrder,
} from '../src/logic.js';

// mulberry32-style PRNG, same generator the existing simulation tests use.
const seeded = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const key = (p) => `${p.x},${p.y}`;
const same = (a, b) => a.x === b.x && a.y === b.y;
const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];
const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const inBounds = (state, p) =>
  p.x >= 0 && p.y >= 0 && p.x < state.w && p.y < state.h;

// Body after one move, or null when the move is a wall or self hit.
const bodyAfter = (state, dir) => {
  const next = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };
  if (!inBounds(state, next)) return null;
  const eat = !!appleAt(state, next);
  const rest = eat ? state.snake : state.snake.slice(0, -1);
  if (rest.some((s) => same(s, next))) return null;
  return [next, ...rest];
};

// Local re-implementation of the planner's safety gate, straight from the
// definition: tail reachable, one connected free region, room for the length.
const gatePass = (state, body, margin = CONFIG.safeMargin) => {
  if (!body) return false;
  const w = state.w;
  const h = state.h;
  const blocked = new Set();
  for (let i = 0; i < body.length - 1; i++) blocked.add(key(body[i]));
  const head = body[0];
  const seen = new Set([key(head)]);
  const queue = [head];
  let free = 0;
  while (queue.length) {
    const p = queue.shift();
    for (const d of DIRS) {
      const c = { x: p.x + d.x, y: p.y + d.y };
      if (!inBounds(state, c)) continue;
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      if (blocked.has(k)) continue;
      free++;
      queue.push(c);
    }
  }
  const tail = body[body.length - 1];
  const total = w * h - body.length + 1;
  return seen.has(key(tail)) && free >= total && free >= body.length + margin;
};

// Tail reachable plus room, the minimum the planner's gate promises.
const roomGate = (state, body, margin = 0) => {
  if (!body) return false;
  const blocked = new Set();
  for (let i = 0; i < body.length - 1; i++) blocked.add(key(body[i]));
  const head = body[0];
  const seen = new Set([key(head)]);
  const queue = [head];
  let free = 0;
  while (queue.length) {
    const p = queue.shift();
    for (const d of DIRS) {
      const c = { x: p.x + d.x, y: p.y + d.y };
      if (!inBounds(state, c)) continue;
      const k = key(c);
      if (seen.has(k)) continue;
      seen.add(k);
      if (blocked.has(k)) continue;
      free++;
      queue.push(c);
    }
  }
  const tail = body[body.length - 1];
  return seen.has(key(tail)) && free >= body.length + margin;
};

// A legal move: in bounds, not into the body (the tail exception counts), and
// not a straight reversal of the last move.
const assertLegalMove = (state, dir) => {
  const next = { x: state.snake[0].x + dir.x, y: state.snake[0].y + dir.y };
  assert.ok(inBounds(state, next), 'move stays on the board');
  assert.ok(!state.snake.slice(0, -1).some((s) => same(s, next)), 'move misses the body');
  const rev = { x: -state.lastMove.x, y: -state.lastMove.y };
  assert.ok(!same(dir, rev), 'move does not reverse');
};

test('the AI walks the fill order cell by cell', () => {
  // The pattern comes from following the fill order exactly: the next move must
  // be the next cell of the order, not a shortcut toward an apple.
  const state = createState(() => 0.5);
  const order = fillOrder(state.w, state.h, state.variant);
  const head = state.snake[0];
  const idx = order.cells.findIndex((c) => c.x === head.x && c.y === head.y);
  const next = order.cells[(idx + 1) % order.n];

  // Keep the board free of items so the only choice left is the order itself.
  state.apples = [];
  state.bombs = [];
  const info = chooseMoveDetailed(state, () => 0.99);
  assert.equal(info.kind, 'pattern');
  assert.deepEqual(info.dir, { x: next.x - head.x, y: next.y - head.y });
  assertLegalMove(state, info.dir);
});

test('gifts land on the path ahead so the snake eats them promptly', () => {
  // Off-pattern chasing would skip an order cell, so "priority" is implemented
  // by placing items where the snake is about to go.
  const state = createState(() => 0.5);
  state.slipChance = 0;
  const order = fillOrder(state.w, state.h, state.variant);
  const head = state.snake[0];
  const headIdx = order.ids[head.y * state.w + head.x];
  const ahead = new Set();
  for (let i = 1; i <= 8; i++) {
    const c = order.cells[(headIdx + i) % order.n];
    ahead.add(`${c.x},${c.y}`);
  }

  let onPath = 0;
  for (let i = 0; i < 20; i++) {
    const a = spawnApple(state);
    if (a && ahead.has(`${a.x},${a.y}`)) onPath++;
    if (a) state.apples.splice(state.apples.indexOf(a), 1);
  }
  assert.ok(onPath >= 10, `only ${onPath}/20 apples landed on the path ahead`);
});

test('route that would trap the snake is rejected', () => {
  // 6x6. The apple at (1,0) is one step left of the head, but eating it fills
  // the last exit of the (0,0) pocket: only (0,0) stays free behind the new
  // head, so the free space splits in two. Stepping right stays connected.
  // y0 . @ * . . .      head (2,0), apple (1,0)
  // y1 # # . . . .      body runs down and left, sealing the pocket
  // y2 # # . . . .
  const state = createState(() => 0.5);
  state.w = 6;
  state.h = 6;
  state.snake = [
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];
  state.dir = { x: -1, y: 0 };
  state.lastMove = { x: -1, y: 0 };
  state.apples = [{ id: 1, x: 1, y: 0 }];
  state.eaten = 1;

  const trap = { x: -1, y: 0 };
  assert.ok(gatePass(state, bodyAfter(state, trap)) === false, 'sealing move must fail the gate');

  const info = chooseMoveDetailed(state, () => 0.99);
  assert.notDeepEqual(info.dir, trap, 'planner must not take the sealing apple');
  assert.equal(info.gate, true, 'a safe move exists, so the gate must stay full');
  assert.ok(gatePass(state, bodyAfter(state, info.dir)), 'chosen move keeps tail and room');
});

test('unsafe drama route is rejected', () => {
  // Same pocket plus a safe apple. With rand() === 0 the drama roll fires, but
  // the dangerous route may never be the sealing one: every accepted route has
  // already passed the gate.
  const state = createState(() => 0.5);
  state.w = 6;
  state.h = 6;
  state.snake = [
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];
  state.dir = { x: -1, y: 0 };
  state.lastMove = { x: -1, y: 0 };
  state.apples = [
    { id: 1, x: 1, y: 0 }, // sealing route, wall-hugging
    { id: 2, x: 3, y: 1 }, // safe route
  ];
  state.eaten = 1;
  state.dramaCooldown = 0;
  state.slipChance = 0;

  const trap = { x: -1, y: 0 };
  assert.equal(roomGate(state, bodyAfter(state, trap)), false, 'trap route is unsafe');
  const info = chooseMoveDetailed(state, () => 0);
  assert.equal(info.gate, true, 'gate must accept a route');
  const after = bodyAfter(state, info.dir);
  assert.ok(after, 'chosen move is legal');
  assert.ok(roomGate(state, after), 'chosen move keeps the tail reachable and room to move');
  assert.notDeepEqual(info.dir, trap, 'the safe option is never the trap');
});

test('opening does not orbit', () => {
  // Following the order means the first 20 cells are all new: no short loop,
  // which is what the old cycle planner did.
  const rand = seeded(1);
  const state = createState(rand);
  state.slipChance = 0;
  const visited = new Set([key(state.snake[0])]);

  for (let i = 0; i < 20; i++) {
    const info = chooseMoveDetailed(state, rand);
    assert.equal(info.kind, 'pattern', `tick ${i} left the fill order`);
    state.dir = info.dir;
    step(state);
    visited.add(key(state.snake[0]));
  }

  assert.equal(visited.size, 21, `opening revisited cells (${visited.size} distinct)`);
  assert.equal(state.dead, false);
});

test('the moving snake eats apples as the order reaches them', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const rand = seeded(seed);
    const state = createState(rand);
    let ticks = 0;
    while (!state.dead && !state.rescuing && state.eaten === 0 && ticks < 170) {
      state.dir = chooseMoveDetailed(state, rand).dir;
      step(state);
      ticks++;
    }
    assert.equal(state.dead, false, `seed ${seed} died at tick ${ticks}`);
    assert.equal(state.rescuing, false, `seed ${seed} trapped itself`);
    assert.equal(state.eaten, 1, `seed ${seed} ate no apple within 170 ticks`);
  }
});

test('every close-call move still passes the safety gate', () => {
  const rand = seeded(7);
  const state = createState(rand);
  state.slipChance = 0;
  let closeCalls = 0;

  for (let i = 0; i < 300; i++) {
    const info = chooseMoveDetailed(state, rand);
    if (info.closeCall && info.kind !== 'slip') {
      closeCalls++;
      assert.equal(info.gate, true, `close call ${closeCalls} at tick ${i} failed the gate`);
    }
    if (state.dead || state.rescuing) break;
    state.dir = info.dir;
    const res = step(state);
    if (res.ate) spawnApple(state);
  }

  assert.equal(state.dead, false);
  assert.ok(closeCalls > 0, 'seed 7 should produce at least one close call');
});
