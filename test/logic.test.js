import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  createState,
  step,
  applyGift,
  chooseMove,
  spawnApple,
  spawnBombAt,
  spawnGiftApple,
  appleAt,
  fillOrder,
  updateRescue,
  updateWin,
} from '../src/logic.js';

const cellKeys = (state) => new Set(state.snake.map((s) => `${s.x},${s.y}`));

const tailReachable = (state) => {
  const blocked = new Set(state.snake.slice(0, -1).map((s) => `${s.x},${s.y}`));
  const head = state.snake[0];
  const tail = state.snake[state.snake.length - 1];
  const seen = new Set([`${head.x},${head.y}`]);
  const queue = [head];
  while (queue.length) {
    const p = queue.shift();
    if (p.x === tail.x && p.y === tail.y) return true;
    for (const d of [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }]) {
      const c = { x: p.x + d.x, y: p.y + d.y };
      const k = `${c.x},${c.y}`;
      if (c.x < 0 || c.y < 0 || c.x >= state.w || c.y >= state.h) continue;
      if (seen.has(k) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(c);
    }
  }
  return false;
};

test('fresh state starts at configured length with one apple off-snake', () => {
  const state = createState(() => 0.5);
  assert.equal(state.snake.length, CONFIG.startLength);
  assert.equal(state.apples.length, 1);
  assert.ok(!cellKeys(state).has(`${state.apples[0].x},${state.apples[0].y}`));
});

test('step moves head one cell in current direction', () => {
  const state = createState(() => 0.5);
  const head = { ...state.snake[0] };
  const dir = { ...state.dir };
  const res = step(state);
  assert.ok(res.moved);
  assert.deepEqual(state.snake[0], { x: head.x + dir.x, y: head.y + dir.y });
});

test('hitting the wall kills the snake', () => {
  const state = createState(() => 0.5);
  let res = { died: false };
  for (let i = 0; i < 20 && !state.dead; i++) res = step(state);
  assert.equal(state.dead, true);
  assert.equal(res.died, true);
  assert.equal(res.reason, 'wall');
});

test('running into own body starts a rescue instead of killing the snake', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
  ];
  state.dir = { x: 0, y: 1 };
  state.apples = [];
  const before = state.snake.map((s) => ({ ...s }));
  const res = step(state);
  assert.equal(res.died, true);
  assert.equal(res.reason, 'self');
  assert.equal(res.rescue, true);
  assert.equal(res.moved, false);
  assert.equal(state.dead, false);
  assert.equal(state.rescuing, true);
  assert.equal(state.rescueMs, CONFIG.rescueMs);
  assert.deepEqual(state.snake, before);
  assert.deepEqual(chooseMove(state), state.dir);
});

test('updateRescue expires into death after rescueMs', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
  ];
  state.dir = { x: 0, y: 1 };
  state.apples = [];
  step(state);

  const idle = updateRescue(state, CONFIG.rescueMs - 1);
  assert.equal(idle.died, false);
  assert.equal(idle.msLeft, 1);
  assert.equal(state.dead, false);
  assert.equal(state.rescuing, true);

  const expired = updateRescue(state, 1);
  assert.equal(expired.died, true);
  assert.equal(state.rescuing, false);
  assert.equal(state.rescueMs, 0);
  assert.equal(state.dead, true);
});

test('only a bomb is accepted while rescuing, and it ends the rescue', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  state.dir = { x: 0, y: 1 };
  state.apples = [];
  const tick = state.tickMs;
  step(state);

  for (const type of ['apple', 'speed', 'slow']) {
    const res = applyGift(state, type);
    assert.equal(res.ok, false, type);
    assert.equal(state.apples.length, 0, type);
    assert.equal(state.tickMs, tick, type);
    assert.equal(state.rescuing, true, type);
  }

  const res = applyGift(state, 'bomb');
  assert.equal(res.ok, true);
  assert.equal(res.removed.length, CONFIG.bombCut);
  assert.equal(state.rescuing, false);
  assert.equal(state.rescueMs, 0);
  assert.equal(state.dead, false);
  assert.equal(updateRescue(state, CONFIG.rescueMs).died, false);
});

test('eating an apple adds exactly one segment', () => {
  const state = createState(() => 0.5);
  state.apples = [
    { id: 99, x: state.snake[0].x + state.dir.x, y: state.snake[0].y + state.dir.y },
  ];
  const before = state.snake.length;
  const res = step(state);
  assert.equal(res.ate.id, 99);
  assert.equal(state.snake.length, before + 1);
  assert.equal(state.apples.length, 0);
});

test('bomb gift picks a landing cell instead of cutting the snake', () => {
  const state = createState(() => 0.5);
  const before = state.snake.length;
  const res = applyGift(state, 'bomb');
  assert.equal(res.ok, true);
  assert.ok(res.cell);
  // A falling bomb is not a board object yet, so it cannot be eaten or targeted.
  assert.equal(state.bombs.length, 0);
  assert.equal(state.snake.length, before);
  assert.ok(!cellKeys(state).has(`${res.cell.x},${res.cell.y}`));

  const bomb = spawnBombAt(state, res.cell);
  assert.ok(bomb);
  assert.equal(state.bombs.length, 1);
});

test('eating a bomb cuts two segments and never drops below the minimum', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
    { x: 2, y: 5 },
    { x: 1, y: 5 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [{ id: 1, x: 0, y: 0 }];
  state.bombs = [{ id: 1, x: 6, y: 5 }];

  const res = step(state);
  assert.equal(res.moved, true);
  assert.equal(res.bomb.id, 1);
  assert.equal(res.removed.length, CONFIG.bombCut);
  assert.equal(state.snake.length, 3);
  assert.equal(state.bombs.length, 0);

  // At the minimum length the bomb still gets eaten, it just cuts nothing.
  state.bombs = [{ id: 2, x: state.snake[0].x + state.dir.x, y: state.snake[0].y }];
  state.snake = [
    { x: 5, y: 6 },
    { x: 4, y: 6 },
    { x: 3, y: 6 },
  ];
  state.dir = { x: 1, y: 0 };
  state.apples = [{ id: 2, x: 0, y: 0 }];
  state.bombs = [{ id: 3, x: 6, y: 6 }];
  const small = step(state);
  assert.equal(small.removed.length, 0);
  assert.equal(state.snake.length, CONFIG.minLength);
});

test('apple gift spawns CONFIG.giftApples distinct apples on free cells', () => {
  const state = createState(() => 0.25);
  const before = state.apples.length;
  const res = applyGift(state, 'apple');
  assert.equal(res.ok, true);
  assert.equal(state.apples.length, before + CONFIG.giftApples);
  const keys = new Set(state.apples.map((a) => `${a.x},${a.y}`));
  assert.equal(keys.size, state.apples.length);
  for (const k of keys) assert.ok(!cellKeys(state).has(k));
});

test('board is a fixed 12x13 and expand/shrink are unknown gift types', () => {
  const state = createState(() => 0.5);
  assert.equal(CONFIG.boardW, 12);
  assert.equal(CONFIG.boardH, 13);
  assert.equal(state.w, 12);
  assert.equal(state.h, 13);

  for (const type of ['expand', 'shrink']) {
    const res = applyGift(state, type);
    assert.equal(res.ok, false, type);
    assert.equal(state.w, 12);
    assert.equal(state.h, 13);
  }
});

test('filling the board starts a victory lap, then wins', () => {
  const state = createState(() => 0.5);
  state.w = 2;
  state.h = 2;
  state.snake = [
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [{ id: 7, x: 1, y: 1 }];

  const res = step(state);
  assert.equal(state.snake.length, 4);
  assert.equal(state.filled, true);
  assert.equal(state.winMs, CONFIG.winDelayMs);
  assert.equal(res.won, false);
  assert.equal(state.won, false);

  const lap = updateWin(state, CONFIG.winDelayMs - 1);
  assert.equal(lap.won, false);
  assert.equal(lap.msLeft, 1);
  assert.equal(state.won, false);

  // The snake keeps moving during the lap and must not die doing it.
  const move = chooseMove(state, () => 0.99);
  state.dir = move;
  const held = step(state);
  assert.equal(state.dead, false);
  assert.equal(state.rescuing, false);
  assert.equal(state.snake.length, 4);
  assert.ok(held.moved || held.held);

  const done = updateWin(state, 2);
  assert.equal(done.won, true);
  assert.equal(state.won, true);
});

test('the victory lap can be switched off from the debug menu', () => {
  const state = createState(() => 0.5);
  state.winDelayMs = 0;
  state.w = 2;
  state.h = 2;
  state.snake = [
    { x: 0, y: 1 },
    { x: 0, y: 0 },
    { x: 1, y: 0 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [{ id: 7, x: 1, y: 1 }];

  step(state);
  assert.equal(state.filled, true);
  assert.equal(state.won, true);
});

test('ai never picks the reversing or wall-crashing move', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 9, y: 5 },
    { x: 8, y: 5 },
    { x: 7, y: 5 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [{ id: 1, x: 9, y: 4 }];

  const move = chooseMove(state, () => 0.99);
  assert.notDeepEqual(move, { x: 1, y: 0 });
  assert.notDeepEqual(move, { x: -1, y: 0 });
  assert.deepEqual(move, { x: 0, y: -1 });
});

test('ai steps onto the apple that sits on the next order cell', () => {
  const state = createState(() => 0.5);
  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };
  state.apples = [{ id: 2, x: next.x, y: next.y }];
  const move = chooseMove(state, () => 0.99);
  assert.deepEqual(move, state.dir);
});

test('the AI follows the fill order instead of detouring to an apple', () => {
  // An apple next to the head does not pull the snake off the order when the
  // move cannot rejoin at the next order cell.
  const state = createState(() => 0.5);
  state.slipChance = 0;
  const order = fillOrder(state.w, state.h, state.variant);
  const head = state.snake[0];
  const idx = order.cells.findIndex((c) => c.x === head.x && c.y === head.y);
  const next = order.cells[(idx + 1) % order.n];
  const bodyKeys = cellKeys(state);
  const near = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const side = near.find((d) => {
    const c = { x: head.x + d.x, y: head.y + d.y };
    if (c.x < 0 || c.y < 0 || c.x >= state.w || c.y >= state.h) return false;
    if (bodyKeys.has(`${c.x},${c.y}`)) return false;
    if (c.x === next.x && c.y === next.y) return false;
    // Must NOT be on the way back to the next order cell.
    return Math.abs(c.x - next.x) + Math.abs(c.y - next.y) !== 1;
  });
  assert.ok(side, 'expected a free cell that is not a rejoin point');
  state.apples = [{ id: 1, x: head.x + side.x, y: head.y + side.y }];
  state.bombs = [];

  const move = chooseMove(state, () => 0.99);
  assert.deepEqual(move, { x: next.x - head.x, y: next.y - head.y });
  assert.notDeepEqual(move, side);
});

test('spawning fails when the board is full', () => {
  const state = createState(() => 0.5);
  state.w = 1;
  state.h = 1;
  state.snake = [{ x: 0, y: 0 }];
  state.apples = [];
  assert.equal(spawnApple(state), null);
});

test('a gift apple takes the tail cell when the board is full', () => {
  const state = createState(() => 0.5);
  state.w = 2;
  state.h = 3;
  state.snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ];
  state.apples = [{ id: 1, x: 1, y: 2 }];
  state.bombs = [];
  state.dir = { x: 0, y: 1 };
  state.lastMove = { x: 0, y: 1 };
  const tail = { ...state.snake[state.snake.length - 1] };

  const apple = spawnGiftApple(state);
  assert.ok(apple);
  assert.equal(apple.x, tail.x);
  assert.equal(apple.y, tail.y);
  assert.equal(state.snake.length, 4);
  assert.equal(state.apples.length, 2);
});

test('procedural apples wait for a free cell and then resume', () => {
  const state = createState(() => 0.5);
  state.w = 2;
  state.h = 3;
  state.snake = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 0, y: 2 },
  ];
  state.apples = [{ id: 1, x: 1, y: 2 }];
  state.bombs = [];

  assert.equal(spawnApple(state), null);
  assert.equal(state.snake.length, 5);

  // Space clears up: the next roll places normally again.
  state.apples = [];
  const apple = spawnApple(state);
  assert.ok(apple);
  assert.equal(state.apples.length, 1);
});

test('appleAt finds apples by coordinate', () => {
  const state = createState(() => 0.5);
  const a = state.apples[0];
  assert.equal(appleAt(state, { x: a.x, y: a.y }), a);
  assert.equal(appleAt(state, { x: -1, y: -1 }), null);
});

test('speed clamps at minTick and reports not ok at the clamp', () => {
  const state = createState(() => 0.5);
  state.tickMs = CONFIG.minTick + CONFIG.speedStep;
  const res = applyGift(state, 'speed');
  assert.equal(res.ok, true);
  assert.equal(state.tickMs, CONFIG.minTick);

  const again = applyGift(state, 'speed');
  assert.equal(again.ok, false);
  assert.equal(again.tickMs, CONFIG.minTick);
  assert.equal(state.tickMs, CONFIG.minTick);
});

test('slow clamps at maxTick and reports not ok at the clamp', () => {
  const state = createState(() => 0.5);
  state.tickMs = CONFIG.maxTick - CONFIG.slowStep;
  const res = applyGift(state, 'slow');
  assert.equal(res.ok, true);
  assert.equal(state.tickMs, CONFIG.maxTick);

  const again = applyGift(state, 'slow');
  assert.equal(again.ok, false);
  assert.equal(again.tickMs, CONFIG.maxTick);
  assert.equal(state.tickMs, CONFIG.maxTick);
});

test('chooseMove with no apples returns a valid direction', () => {
  const state = createState(() => 0.5);
  state.apples = [];
  const move = chooseMove(state, () => 0.99);
  const valid = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  assert.ok(valid.some((d) => d.x === move.x && d.y === move.y));
  assert.ok(Number.isFinite(move.x) && Number.isFinite(move.y));
});

test('gifts do not mutate the board while dead or won', () => {
  for (const flag of ['dead', 'won']) {
    for (const type of ['apple', 'bomb', 'speed', 'slow']) {
      const state = createState(() => 0.5);
      state.snake = [
        { x: 5, y: 5 },
        { x: 4, y: 5 },
        { x: 3, y: 5 },
        { x: 2, y: 5 },
      ];
      state.apples = [{ id: 1, x: 0, y: 0 }];
      state.tickMs = CONFIG.tickMs;
      state[flag] = true;
      const before = JSON.stringify({
        w: state.w,
        h: state.h,
        snake: state.snake,
        apples: state.apples,
        tickMs: state.tickMs,
        dead: state.dead,
        won: state.won,
      });
      const res = applyGift(state, type);
      assert.equal(res.ok, false, `${type} while ${flag}`);
      assert.equal(
        JSON.stringify({
          w: state.w,
          h: state.h,
          snake: state.snake,
          apples: state.apples,
          tickMs: state.tickMs,
          dead: state.dead,
          won: state.won,
        }),
        before,
        `${type} mutated board while ${flag}`,
      );
    }
  }
});

test('ai takes the apple over the Hamiltonian step even when that step is unsafe', () => {
  // 8x8. Apples sit right (2,1) and up (1,0) of the head, both one step away.
  // Either jump keeps the body ordered along the cycle, so both are safe; the
  // cycle-distance tie is broken by the move that advances least, so the test
  // accepts either apple cell rather than pinning one down.
  // y0 . * . . . . . .
  // y1 # @ * . . . . .
  // y2 # # # . . . . .
  // y3 # # # . . . . .
  // y4 # # . . . . . .
  const state = createState(() => 0.5);
  state.w = 8;
  state.h = 8;
  state.snake = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 3 },
    { x: 1, y: 3 },
    { x: 1, y: 4 },
    { x: 0, y: 4 },
    { x: 0, y: 3 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [
    { id: 1, x: 2, y: 1 },
    { id: 2, x: 1, y: 0 },
  ];

  const move = chooseMove(state, () => 0.99);
  // Both apples are one step away; equal-length ties are randomised on purpose.
  assert.ok(
    (move.x === 1 && move.y === 0) || (move.x === 0 && move.y === -1),
    JSON.stringify(move)
  );
});

test('ai eats the apple below and keeps surviving', () => {
  // 7x7. The apple below the head is reachable right now and, as the graph
  // search proves, eating it keeps an escape route to the tail.
  // y0 . . . . # # #
  // y1 . . . . @ . #
  // y2 . . . . * # #
  // y3 . . . # # # #
  // y4 . . . # # # #
  // y5 . . . # # . .
  // y6 . . * . * * .
  const state = createState(() => 0.5);
  state.w = 7;
  state.h = 7;
  state.snake = [
    { x: 4, y: 1 },
    { x: 4, y: 0 },
    { x: 5, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 1 },
    { x: 6, y: 2 },
    { x: 6, y: 3 },
    { x: 6, y: 4 },
    { x: 5, y: 4 },
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
    { x: 3, y: 4 },
    { x: 3, y: 3 },
    { x: 4, y: 3 },
    { x: 5, y: 3 },
    { x: 5, y: 2 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [
    { id: 1, x: 4, y: 2 },
    { id: 2, x: 2, y: 6 },
    { id: 3, x: 4, y: 6 },
    { id: 4, x: 5, y: 6 },
  ];

  const move = chooseMove(state, () => 0.99);
  assert.deepEqual(move, { x: 0, y: 1 });

  // Safety invariant: after the eat the tail is still reachable and the snake
  // keeps surviving, so taking the apple is not a dead end.
  state.dir = move;
  const res = step(state);
  assert.equal(res.ate.id, 1);
  assert.equal(state.dead, false);
  assert.ok(tailReachable(state));
  for (let i = 0; i < 400; i++) {
    state.dir = chooseMove(state, () => 0.99);
    step(state);
    assert.equal(state.dead, false, `died at follow-up move ${i}`);
  }
});

test('snake may move into the cell vacated by its tail', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 1, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ];
  state.dir = { x: 0, y: 1 };
  state.lastMove = { x: 0, y: 1 };
  state.apples = [];
  const res = step(state);
  assert.equal(state.dead, false);
  assert.equal(res.moved, true);
  assert.deepEqual(state.snake[0], { x: 1, y: 1 });
  assert.equal(state.snake.length, 4);
});

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

const playToEnd = (seed, maxTicks = 20000) => {
  const rand = seeded(seed);
  const state = createState(rand);
  const appleTicks = Math.round(CONFIG.appleIntervalMs / CONFIG.tickMs);
  let ticks = 0;
  let clock = 0;
  while (!state.won && !state.dead && !state.rescuing && ticks < maxTicks) {
    state.dir = chooseMove(state, rand);
    step(state);
    updateWin(state, CONFIG.tickMs);
    ticks++;
    clock++;
    if (clock >= appleTicks) {
      clock = 0;
      if (state.apples.length < CONFIG.maxApples) spawnApple(state);
    }
  }
  return { state, ticks };
};

test('every seeded round ends instead of stalling', () => {
  // The AI is beatable on purpose, so a seed may end in a crash; what must never
  // happen is a round that runs forever without winning or dying.
  for (let seed = 1; seed <= 5; seed++) {
    const { state, ticks } = playToEnd(seed);
    assert.ok(
      state.won || state.dead || state.rescuing,
      `seed ${seed} stalled after ${ticks} ticks at length ${state.snake.length}`,
    );
    if (state.won) assert.equal(state.snake.length, state.w * state.h);
  }
});
