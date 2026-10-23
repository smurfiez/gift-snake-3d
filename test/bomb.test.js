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

test('bomb gift respects the board cap', () => {
  const state = createState(() => 0.5);
  for (let i = 0; i < CONFIG.maxBombs; i++) {
    const cell = applyGift(state, 'bomb');
    assert.equal(cell.ok, true);
    assert.ok(spawnBombAt(state, cell.cell));
  }
  assert.equal(state.bombs.length, CONFIG.maxBombs);
  assert.equal(applyGift(state, 'bomb').ok, false);
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

test('ai eats a bomb before an apple at the same distance', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 5, y: 6 },
    { x: 4, y: 6 },
    { x: 3, y: 6 },
  ];
  state.dir = { x: 0, y: -1 };
  state.lastMove = { x: 0, y: -1 };
  state.apples = [{ id: 1, x: 5, y: 8 }];
  state.bombs = [{ id: 7, x: 7, y: 6 }];

  const info = chooseMoveDetailed(state, () => 0.99);
  assert.deepEqual(info.dir, { x: 1, y: 0 }, JSON.stringify(info));
  assert.equal(info.gate, true);
});

test('ai eats a bomb when it is the only food and keeps surviving', () => {
  const state = createState(() => 0.5);
  state.snake = [
    { x: 5, y: 6 },
    { x: 5, y: 7 },
    { x: 4, y: 7 },
    { x: 4, y: 6 },
    { x: 4, y: 5 },
  ];
  state.dir = { x: 1, y: 0 };
  state.lastMove = { x: 1, y: 0 };
  state.apples = [{ id: 1, x: 11, y: 12 }];
  state.bombs = [{ id: 2, x: 6, y: 6 }];

  const move = chooseMove(state, () => 0.99);
  assert.deepEqual(move, { x: 1, y: 0 });

  state.dir = move;
  const res = step(state);
  assert.equal(res.bomb.id, 2);
  assert.equal(res.removed.length, CONFIG.bombCut);
  assert.equal(state.bombs.length, 0);

  for (let i = 0; i < 200; i++) {
    state.dir = chooseMove(state, () => 0.99);
    step(state);
    assert.equal(state.dead, false, `died after the bomb at move ${i}`);
    assert.equal(state.rescuing, false, `trapped after the bomb at move ${i}`);
  }
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
