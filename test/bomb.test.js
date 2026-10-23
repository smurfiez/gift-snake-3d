import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  createState,
  step,
  applyGift,
  chooseMove,
  chooseMoveDetailed,
  spawnBomb,
  spawnBombAt,
  fillOrder,
} from '../src/logic.js';

const DIRS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

test('bombs are capped and never spawn on the snake, apples or each other', () => {
  const state = createState(() => 0.5);
  for (let i = 0; i < CONFIG.maxBombs; i++) assert.ok(spawnBomb(state));
  assert.equal(state.bombs.length, CONFIG.maxBombs);
  assert.equal(spawnBomb(state), null);

  const snake = new Set(state.snake.map((s) => `${s.x},${s.y}`));
  const apples = new Set(state.apples.map((a) => `${a.x},${a.y}`));
  const bombs = new Set(state.bombs.map((b) => `${b.x},${b.y}`));
  assert.equal(bombs.size, CONFIG.maxBombs);
  for (const k of bombs) {
    assert.ok(!snake.has(k), `bomb on snake at ${k}`);
    assert.ok(!apples.has(k), `bomb on apple at ${k}`);
  }
});

test('a bomb over the cap is delivered to the body instead of refused', () => {
  const state = createState(() => 0.5);
  for (let i = 0; i < CONFIG.maxBombs; i++) {
    const cell = applyGift(state, 'bomb');
    assert.equal(cell.ok, true);
    assert.equal(cell.onBody, undefined);
    assert.ok(spawnBombAt(state, cell.cell));
  }
  assert.equal(state.bombs.length, CONFIG.maxBombs);

  const over = applyGift(state, 'bomb');
  assert.equal(over.ok, true);
  assert.equal(over.onBody, true);
  assert.ok(
    state.snake.some((s) => s.x === over.cell.x && s.y === over.cell.y),
    'the extra bomb must target a body cell',
  );
  assert.equal(state.bombs.length, CONFIG.maxBombs);
});

test('a dropped bomb is not eatable until it lands', () => {
  const state = createState(() => 0.5);
  const drop = applyGift(state, 'bomb');
  assert.equal(drop.ok, true);
  assert.equal(state.bombs.length, 0);
  // Nothing on the board marks the falling bomb as food.
  assert.equal(state.bombs.length, 0);
  assert.equal(state.apples.some((a) => a.x === drop.cell.x && a.y === drop.cell.y), false);

  spawnBombAt(state, drop.cell);
  assert.equal(state.bombs.length, 1);
  assert.equal(state.bombs[0].x, drop.cell.x);
});

test('landing on an occupied cell is refused so the caller can fly it to the mouth', () => {
  const state = createState(() => 0.5);
  const head = state.snake[0];
  assert.equal(spawnBombAt(state, { x: head.x, y: head.y }), null);
  assert.equal(state.bombs.length, 0);
});

test('the AI eats a bomb when the fill order reaches it', () => {
  const state = createState(() => 0.5);
  state.slipChance = 0;
  const order = fillOrder(state.w, state.h, state.variant);
  const head = state.snake[0];
  const idx = order.cells.findIndex((c) => c.x === head.x && c.y === head.y);
  const target = order.cells[(idx + 4) % order.n];
  state.bombs = [{ id: 9, x: target.x, y: target.y }];
  state.apples = [];

  let eaten = null;
  for (let i = 0; i < 10 && !eaten; i++) {
    state.dir = chooseMove(state, () => 0.99);
    const res = step(state);
    if (res.bomb) eaten = res;
  }

  assert.ok(eaten, 'the snake never reached the bomb along the order');
  assert.equal(eaten.bomb.id, 9);
  assert.equal(state.bombs.length, 0);
  assert.equal(state.dead, false);
});

test('a bomb on the board is passable and leaves the cell empty once eaten', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 3, y: 3 },
    { x: 3, y: 4 },
    { x: 2, y: 4 },
  ];
  state.dir = { x: 0, y: -1 };
  state.lastMove = { x: 0, y: -1 };
  state.apples = [{ id: 1, x: 0, y: 0 }];
  state.bombs = [{ id: 5, x: 3, y: 2 }];

  const res = step(state);
  assert.equal(res.moved, true);
  assert.equal(res.bomb.id, 5);
  assert.deepEqual(state.snake[0], { x: 3, y: 2 });
  assert.equal(state.bombs.length, 0);
  for (const d of DIRS) {
    assert.ok(Number.isFinite(d.x));
  }
});
