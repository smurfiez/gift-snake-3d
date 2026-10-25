import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG,
  createState,
  upcomingCells,
  spawnGiftApples,
  plantApples,
  pullApplesToward,
  driftApple,
  scatterApples,
  primeBomb,
  advanceBombs,
  step,
} from '../src/logic.js';

const W = 8;
const H = 9;

const same = (a, b) => a.x === b.x && a.y === b.y;

// createState with a fixed rand keeps the shape deterministic, then every field
// the stage helpers read is replaced so each test owns its board.
function board(over = {}) {
  const state = createState(() => 0, { w: W, h: H });
  state.w = over.w ?? W;
  state.h = over.h ?? H;
  state.variant = over.variant ?? 0;
  state.rand = () => 0;
  state.snake = (over.snake ?? [{ x: 0, y: 4 }, { x: 0, y: 3 }, { x: 0, y: 2 }])
    .map((p) => ({ x: p.x, y: p.y }));
  state.apples = (over.apples ?? []).map((p, i) => ({ id: 100 + i, x: p.x, y: p.y }));
  state.bombs = (over.bombs ?? []).map((p, i) => ({ id: 100 + i, x: p.x, y: p.y }));
  state.dead = false;
  state.won = false;
  state.filled = false;
  return state;
}

function makeBomb(x, y) {
  return { id: 1, x, y };
}

test('pair places a second apple on a free neighbour of the first', () => {
  const state = board();
  const out = spawnGiftApples(state, 'pair');

  assert.equal(out.length, 2);
  assert.equal(state.apples.length, 2);
  const [first, second] = out;
  assert.equal(Math.abs(first.x - second.x) + Math.abs(first.y - second.y), 1, 'apples not adjacent');
  assert.ok(!state.snake.some((s) => same(s, second)), 'second apple landed on the snake');
  assert.ok(!same(first, second), 'apples overlap');
});

test('twin mirrors the first apple across the board centre', () => {
  const state = board();
  const out = spawnGiftApples(state, 'twin');

  assert.equal(out.length, 2);
  const [first, second] = out;
  assert.deepEqual(second, { id: second.id, x: state.w - 1 - first.x, y: state.h - 1 - first.y });
  assert.ok(!same(first, second), 'mirror collapsed onto the first apple');
});

test('twin keeps the first apple when the mirror is occupied', () => {
  const state = board();
  const ahead = upcomingCells(state, 8);
  assert.ok(ahead.length > 0, 'no upcoming cell to predict the first apple');
  const first = ahead[0];
  const mirror = { x: W - 1 - first.x, y: H - 1 - first.y };
  state.snake.push(mirror);
  assert.deepEqual(upcomingCells(state, 8)[0], first, 'occupying the mirror moved the first apple');

  const out = spawnGiftApples(state, 'twin');
  assert.equal(out.length, 1);
  assert.deepEqual({ x: out[0].x, y: out[0].y }, first);
  assert.ok(!state.snake.some((s) => same(s, out[0])), 'apple landed on the snake');
});

test('pass lands on the farthest upcoming cell', () => {
  const state = board();
  const expected = upcomingCells(state, CONFIG.chaseReach).at(-1);
  assert.ok(expected, 'no upcoming cell for the pass');

  const out = spawnGiftApples(state, 'pass');
  assert.equal(out.length, 1);
  assert.equal(state.apples.length, 1);
  assert.deepEqual({ x: out[0].x, y: out[0].y }, expected);
});

test('slide skids the apple to the last free cell along state.dir', () => {
  const open = board();
  open.dir = { x: 1, y: 0 };
  const start = upcomingCells(open, 8)[0];
  assert.ok(start, 'no upcoming cell to slide from');

  const toWall = spawnGiftApples(open, 'slide');
  assert.equal(toWall.length, 1);
  assert.deepEqual(
    { x: toWall[0].x, y: toWall[0].y },
    { x: W - 1, y: start.y },
    'apple did not stop at the wall'
  );

  const blocked = board();
  blocked.dir = { x: 1, y: 0 };
  blocked.bombs = [makeBomb(start.x + 2, start.y)];
  const toBlocker = spawnGiftApples(blocked, 'slide');
  assert.equal(toBlocker.length, 1);
  assert.deepEqual(
    { x: toBlocker[0].x, y: toBlocker[0].y },
    { x: start.x + 1, y: start.y },
    'apple did not stop before the blocker'
  );
  assert.ok(!blocked.bombs.some((b) => same(b, toBlocker[0])), 'apple slid onto the bomb');
});

test('driftApple moves one free orthogonal cell and stops when boxed in', () => {
  const state = board({ apples: [{ x: 4, y: 1 }] });
  state.rand = () => 0.9;
  const apple = state.apples[0];
  const from = { x: apple.x, y: apple.y };

  const to = driftApple(state, apple);

  assert.deepEqual(to, { x: 4, y: 2 }, 'drift did not take the cell nearest the centre');
  assert.deepEqual({ x: apple.x, y: apple.y }, to);
  assert.equal(Math.abs(to.x - from.x) + Math.abs(to.y - from.y), 1, 'drift moved more than one cell');
  assert.ok(!state.snake.some((s) => same(s, apple)), 'drift landed on the snake');
  assert.ok(!state.bombs.some((b) => same(b, apple)), 'drift landed on a bomb');

  const boxed = board({ snake: [{ x: 1, y: 0 }, { x: 0, y: 1 }], apples: [{ x: 0, y: 0 }] });
  assert.equal(driftApple(boxed, boxed.apples[0]), null, 'boxed apple still drifted');
  assert.deepEqual({ x: boxed.apples[0].x, y: boxed.apples[0].y }, { x: 0, y: 0 });
});

test('scatterApples gives every apple a distinct free cell', () => {
  const state = board({
    bombs: [{ x: 1, y: 0 }],
    apples: [{ x: 5, y: 5 }, { x: 6, y: 6 }, { x: 7, y: 7 }],
  });
  state.rand = () => 0;

  const moved = scatterApples(state);

  assert.equal(moved, 3);
  const seen = new Set();
  for (const apple of state.apples) {
    const k = `${apple.x},${apple.y}`;
    assert.ok(!seen.has(k), `duplicate apple at ${k}`);
    seen.add(k);
    assert.ok(apple.x >= 0 && apple.y >= 0 && apple.x < W && apple.y < H, `apple at ${k} left the board`);
    assert.ok(!state.snake.some((s) => same(s, apple)), `apple at ${k} landed on the snake`);
    assert.ok(!state.bombs.some((b) => same(b, apple)), `apple at ${k} landed on a bomb`);
  }
});

test('scatterApples counts only the apples that changed cell', () => {
  const state = board({ apples: [{ x: 0, y: 0 }, { x: 5, y: 5 }] });
  state.rand = () => 0;

  assert.equal(scatterApples(state), 1);
  assert.deepEqual({ x: state.apples[0].x, y: state.apples[0].y }, { x: 0, y: 0 });
});

test('plantApples fills free cells around the centre and never the snake', () => {
  const centre = { x: 4, y: 4 };
  const state = board({ snake: [{ x: 4, y: 3 }, { x: 3, y: 4 }, { x: 0, y: 8 }] });
  const out = plantApples(state, centre, 3);

  assert.equal(out.length, 3);
  assert.equal(state.apples.length, 3);
  const seen = new Set();
  for (const apple of out) {
    const k = `${apple.x},${apple.y}`;
    assert.ok(!seen.has(k), `duplicate apple at ${k}`);
    seen.add(k);
    assert.ok(!state.snake.some((s) => same(s, apple)), `apple at ${k} landed on the snake`);
    assert.ok(
      Math.abs(apple.x - centre.x) + Math.abs(apple.y - centre.y) <= 2,
      `apple at ${k} is not near the centre`
    );
  }
});

test('pullApplesToward moves one cell on the dominant axis', () => {
  const state = board({ snake: [{ x: 0, y: 8 }, { x: 1, y: 8 }], apples: [{ x: 1, y: 1 }] });
  const moved = pullApplesToward(state, { x: 5, y: 4 });

  assert.equal(moved, 1);
  assert.deepEqual({ x: state.apples[0].x, y: state.apples[0].y }, { x: 2, y: 1 });
});

test('pullApplesToward never moves an apple onto the snake', () => {
  const state = board({ snake: [{ x: 2, y: 1 }, { x: 2, y: 2 }], apples: [{ x: 1, y: 1 }] });
  const moved = pullApplesToward(state, { x: 5, y: 4 });

  assert.equal(moved, 0);
  assert.deepEqual({ x: state.apples[0].x, y: state.apples[0].y }, { x: 1, y: 1 });
});

test('tide bomb drifts three cells toward the head then stops', () => {
  const state = board({ snake: [{ x: 7, y: 4 }, { x: 6, y: 4 }, { x: 5, y: 4 }] });
  const bomb = makeBomb(0, 4);
  state.bombs = [bomb];
  primeBomb(bomb, 'tide', { x: -1, y: 0 });

  for (let i = 0; i < 3 + 3; i++) {
    assert.equal(advanceBombs(state).length, 0);
  }
  assert.deepEqual({ x: bomb.x, y: bomb.y }, { x: 3, y: 4 });
  assert.equal(bomb.moves, 3);
  assert.equal(bomb.spent, false);

  assert.equal(advanceBombs(state).length, 0);
  assert.equal(bomb.spent, true);
  assert.deepEqual({ x: bomb.x, y: bomb.y }, { x: 3, y: 4 }, 'tide bomb kept drifting past three cells');
});

test('kick bomb rolls straight to the wall and spends', () => {
  const state = board({ snake: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] });
  const bomb = makeBomb(0, 5);
  state.bombs = [bomb];
  primeBomb(bomb, 'kick', { x: 1, y: 0 });

  for (let i = 0; i < 12; i++) advanceBombs(state);

  assert.equal(bomb.x, W - 1);
  assert.equal(bomb.y, 5);
  assert.equal(bomb.spent, true);
  assert.equal(state.bombs.length, 1);
});

test('barrel bomb reverses at the wall and stays in bounds', () => {
  const state = board({ snake: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }] });
  const bomb = makeBomb(1, 5);
  state.bombs = [bomb];
  primeBomb(bomb, 'barrel', { x: 1, y: 0 });

  let reversed = false;
  for (let i = 0; i < 20; i++) {
    advanceBombs(state);
    assert.ok(bomb.x >= 0 && bomb.x < W && bomb.y >= 0 && bomb.y < H, `barrel left the board at ${bomb.x},${bomb.y}`);
    if (bomb.dir.x === -1) reversed = true;
  }
  assert.equal(reversed, true, 'barrel never bounced off the wall');
  assert.equal(bomb.spent, false);
});

test('a moving bomb that reaches the snake detonates and cuts the tail', () => {
  const state = board({
    snake: [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 5, y: 7 },
      { x: 4, y: 7 },
      { x: 3, y: 7 },
    ],
  });
  const bomb = makeBomb(3, 5);
  state.bombs = [bomb];
  primeBomb(bomb, 'kick', { x: 1, y: 0 });

  const events = [];
  for (let i = 0; i < 8; i++) events.push(...advanceBombs(state));

  assert.equal(events.length, 1);
  assert.equal(events[0].bomb, bomb);
  assert.deepEqual(events[0].at, { x: 4, y: 5 });
  assert.equal(events[0].removed.length, 2);
  assert.equal(state.bombs.includes(bomb), false);
  assert.equal(state.bombs.length, 0);
  assert.equal(state.snake.length, 3);
});

test('a static-effect bomb keeps its cell when primed with a direction', () => {
  const state = board({ snake: [{ x: 5, y: 4 }, { x: 6, y: 4 }, { x: 7, y: 4 }] });
  const bomb = makeBomb(0, 4);
  state.bombs = [bomb];
  primeBomb(bomb, 'compost', { x: 1, y: 0 });

  const events = [];
  for (let i = 0; i < 6; i++) events.push(...advanceBombs(state));

  assert.equal(events.length, 0, 'a static-effect bomb touched the snake');
  assert.equal(state.snake.length, 3, 'static-effect bomb cut the snake');
  assert.deepEqual({ x: bomb.x, y: bomb.y }, { x: 0, y: 4 }, 'static-effect bomb rolled');
  assert.equal(bomb.spent, true);
  assert.equal(state.bombs.length, 1, 'static-effect bomb left the board');
});

test('a bomb eaten on a full board cancels the victory lap', () => {
  const filledSnake = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 3, y: 3 }, { x: 2, y: 3 },
    { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 },
    { x: 1, y: 3 }, { x: 0, y: 3 }, { x: 0, y: 2 }, { x: 0, y: 1 },
  ];
  const state = board({ w: 4, h: 4, snake: filledSnake, bombs: [{ x: 0, y: 1 }] });
  state.dir = { x: 0, y: 1 };
  state.filled = true;
  state.winMs = 500;

  const bomb = state.bombs[0];
  const result = step(state);

  assert.equal(result.bomb, bomb);
  assert.equal(state.snake.length, 14);
  assert.equal(state.filled, false, 'lap survived a bomb cut');
  assert.equal(state.winMs, 0, 'lap clock survived a bomb cut');
});
