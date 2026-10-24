# Rim Crowd, Scenery, and Apron Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the five rim spectators walk freely around the outside apron, add scenery props out there, and frame the stage so both stay visible.

**Architecture:** Pure apron math (where to stand, how to walk, where props go) goes in a new `src/apron.js` module so it can be unit tested with `node --test` like `src/logic.js`. `src/game.js` consumes it for camera framing, prop meshes, and spectator locomotion. No new dependencies; the render side stays in the existing single game module.

**Tech Stack:** ES modules, Three.js 0.160 via CDN import map, `node --test` for pure modules, built-in browser tools for visual checks.

**Spec:** This plan implements the three pending items agreed in session on 2026-10-24: (1) walkers move around the apron instead of fixed posts, (2) scenery outside the map, (3) framing so walkers and bubbles are not clipped. Current shipped behaviour: five fixed posts along the front rim, idle bob, chat bubbles with replies, avatar + throw on every apple/bomb gift, width-fitted board.

## Global Constraints

- No build step, no new npm dependencies. Browser code loads as ES modules from `index.html`.
- `src/logic.js` stays free of Three.js and DOM. New pure code goes in `src/apron.js` with the same style (named exports, plain objects, no classes).
- All randomness in pure modules is injected: `rand = Math.random` parameter, never read directly.
- Palette stays pastel toon; reuse `toonRamp` and existing mesh materials where possible.
- Keep the current public hook `window.__snake` shape; add nothing to it unless a verification step below names it.
- A reset (`reset()` in `src/game.js`) must clear transient crowd state: walk targets, jobs, projectiles, bubbles.
- No commit may include `README.md`, `test/ai.test.js`, or other pre-existing user edits.

## Review Focus

- **Walker leaves the apron** — a target or a step must never put a figure inside the board or past the far edge; test: `apronPoint`/`walkStep` bounds in Task 1, live positions sampled in Task 4.
- **Walker stands inside a prop** — scenery layout must keep a gap to the walk band; test: min-distance assertion in Task 1.
- **Throw starts from the wrong place after walking** — hand origin must come from the walked world position; browser check in Task 5.
- **Camera clips the apron on the short axis** — framing must hold the stage rectangle on both axes; scripted NDC assertion in Task 2.
- **Chat bubble spam while walking** — talk only while paused, one bubble per figure; state assertion in Task 4.
- **Reset mid-walk leaves a figure on a stale target** — cleared state check in Task 4.
- **Wide viewport (desktop landscape)** — board must stay fully visible with the margin; NDC assertion in Task 2 uses the live canvas aspect, so it covers this.

---

### Task 1: Apron math module

**Files:**
- Create: `src/apron.js`
- Test: `test/apron.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export const APRON = { near: 0.7, far: 2.5, frontBias: 0.72, spacing: 0.85 }`
  - `export function apronPoint(w: number, h: number, rand = Math.random, bias = APRON.frontBias): { x: number, z: number }`
  - `export function walkStep(pos: {x:number,z:number}, target: {x:number,z:number}, speed: number, dt: number): { x: number, z: number, arrived: boolean }` — never mutates inputs.
  - `export function faceYaw(from: {x:number,z:number}, to: {x:number,z:number}): number` — `Math.atan2(to.x - from.x, to.z - from.z)`.
  - `export function clearOf(point: {x:number,z:number}, others: Array<{x:number,z:number}>, minDist: number): boolean`
  - `export function sceneryLayout(w: number, h: number, rand = Math.random, count = 14): Array<{ kind: string, x: number, z: number, rot: number, scale: number }>` with `kind` from `['bush', 'rock', 'flower', 'crate']`.

- [ ] **Step 1: Write the failing tests**

Create `test/apron.test.js` with one `test(...)` per behaviour:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { APRON, apronPoint, walkStep, faceYaw, clearOf, sceneryLayout } from '../src/apron.js';

const insideApron = (p, w, h) => {
  const outX = Math.min(Math.abs(p.x), Math.abs(w - p.x));
  const outZ = Math.min(Math.abs(p.z), Math.abs(h - p.z));
  const outsideBoard = p.x < -0.01 || p.x > w + 0.01 || p.z < -0.01 || p.z > h + 0.01;
  return outsideBoard && Math.max(outX, outZ) <= APRON.far + 0.001;
};
```

Assertions to cover:

```js
// 200 samples of a 16 x 17 board: every point is off the board and within APRON.far of an edge.
// A point never lands inside the board, even with rand pinned to 0 and to 0.999.
// walkStep covers at most speed * dt and reports arrived when the target is within reach.
// walkStep does not mutate pos or target.
// faceYaw returns Math.PI / 2 for a target to the +X side, 0 for +Z.
// clearOf is false at spacing / 2 from another point and true beyond spacing.
// sceneryLayout(w, h, rand, 14) returns 14 items, all inside the apron, all kinds known,
//   every pair at least APRON.spacing apart, and no item inside the board.
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test test/apron.test.js`
Expected: FAIL with `Cannot find module '../src/apron.js'`.

- [ ] **Step 3: Implement `src/apron.js`**

Rules the tests pin:
- `apronPoint`: with probability `1 - bias` pick a side band (left or right), otherwise the front band. Front band: `x = 0.6 + rand() * (w - 1.2)`, `z = h + near + rand() * (far - near)`. Side band: `z = h * 0.3 + rand() * (h * 0.7 + near)`, `x = ±(near + rand() * (far - near))`, sign from `rand() < 0.5`.
- `walkStep`: clamp `speed * dt` to the remaining distance; `arrived` true when remaining `<= 0.05` or the step reaches it.
- `sceneryLayout`: rejection-sample apron points with `clearOf` against already placed props using `APRON.spacing`; bail out after 200 tries per prop so a tiny board cannot loop forever.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test test/apron.test.js`
Expected: PASS, all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/apron.js test/apron.test.js
git commit -m "feat: add pure apron math for rim crowd and scenery"
```

### Task 2: Stage framing

**Files:**
- Modify: `src/game.js` (constant block near `CAM_TILT`; `fitDistance`)
- No unit test: this is camera math that needs the live renderer.

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `const RIM_FRAME = 1.45` next to `CAM_TILT`, used only by `fitDistance`.

- [ ] **Step 1: Add the constant**

Next to `CAM_TILT`, add `const RIM_FRAME = 1.45;` with a one-line comment that the stage rectangle is the board plus this ring, because the crowd lives there.

- [ ] **Step 2: Fit the stage rectangle on both axes**

In `fitDistance`, loop `x` over `[-RIM_FRAME, state.w + RIM_FRAME]`, `z` over `[-RIM_FRAME, state.h + RIM_FRAME]`, `y` over `[0, 2.2]`, and take the max of both `right / tanH + along` and `up / tanV + along`, as the pre-apron version did. Keep the trailing `* 1.01 + 0.4` padding.

- [ ] **Step 3: Verify framing in the browser**

Serve with `python3 -m http.server 5199`, open `http://localhost:5199/index.html`, and run this evaluation:

```js
new Promise((res) => {
  const cam = window.__snake.camera, s = window.__snake.state();
  const pts = [[-1.45,-1.45],[s.w+1.45,-1.45],[-1.45,s.h+1.45],[s.w+1.45,s.h+1.45]];
  const out = pts.map(([x,z]) => {
    const v = window.__snake.scene.position.clone().set(x, 0, z);
    v.project(cam);
    return [+v.x.toFixed(2), +v.y.toFixed(2)];
  });
  requestAnimationFrame(() => res(out));
})
```

Expected: every NDC pair inside `[-1, 1]`, board edges near `±0.84` on X. Then take a screenshot and confirm the board spans most of the app panel width with a visible apron strip below the front wall.

- [ ] **Step 4: Commit**

```bash
git add src/game.js
git commit -m "feat: frame the stage with a rim apron"
```

### Task 3: Scenery props on the apron

**Files:**
- Modify: `src/game.js` (new section after the board layout code; `layoutBoard`)
- Consumes: `sceneryLayout`, `APRON` from `src/apron.js`.
- Produces: `const sceneryGroup = new THREE.Group()` added to `scene` once; `function layoutScenery()` that clears and rebuilds it.

- [ ] **Step 1: Build the prop factories**

Shared geometries and toon materials, one factory per kind:
- `bush`: three overlapping icosahedrons, green pastel.
- `rock`: one dodecahedron, lilac grey.
- `flower`: thin cylinder stem plus a sphere head, warm pink.
- `crate`: rounded box, warm wood tone.

Each factory returns a `THREE.Group` and sets `userData.kind`. Reuse the existing `toonRamp` material pattern; do not add new lights.

- [ ] **Step 2: Place them from the pure layout**

`layoutScenery()` calls `sceneryLayout(state.w, state.h)`, removes all children of `sceneryGroup`, and adds one mesh per item at `(x, 0, z)` with `rotation.y = rot` and `scale.setScalar(scale)`. Call it from `layoutBoard()` next to the existing `layoutSpectators()` call so widen/taller rounds rebuild the ring.

- [ ] **Step 3: Verify in the browser**

Run:

```js
(() => {
  const s = window.__snake.state();
  const props = [];
  window.__snake.scene.traverse((o) => { if (o.userData && o.userData.kind) props.push([o.position.x, o.position.z]); });
  const bad = props.filter(([x, z]) => x > 0 && x < s.w && z > 0 && z < s.h);
  return { count: props.length, insideBoard: bad.length };
})()
```

Expected: `count` between 10 and 16, `insideBoard` 0. Screenshot: props sit outside the walls and are not hidden behind the board.

- [ ] **Step 4: Commit**

```bash
git add src/game.js
git commit -m "feat: scatter scenery props around the rim"
```

### Task 4: Walking spectators

**Files:**
- Modify: `src/game.js` (`makeSpectator`, `layoutSpectators`, `updateSpectators`, `clearSpectator`, `throwWithSpectators`)
- Consumes: `APRON`, `apronPoint`, `walkStep`, `faceYaw`, `clearOf` from `src/apron.js`.
- Produces: spectator objects gain `dest`, `restT`, `walkT`; no public API change.

- [ ] **Step 1: Give each spectator walk state**

In `makeSpectator`, add `dest: null`, `restT: rnd(0.4, 1.8)`, `walkT: 0`, and set `fig.userData.isSpectator = true` (the verification script looks for it). In `clearSpectator`, reset `dest = null`, `restT = rnd(0.6, 2)`, and keep the existing job/bubble resets.

- [ ] **Step 2: Start posts anywhere on the apron**

In `layoutSpectators`, place figures at `apronPoint(w, h)` instead of the five fixed X coordinates. Keep `fig.lookAt(w / 2, 0, h / 2)` for the initial facing and store `baseYaw`.

- [ ] **Step 3: Walk in `updateSpectators`**

In the `if (!j)` idle branch, before the bubble logic:
- If `dest` is null: count `restT` down; at zero set `dest = apronPoint(...)`, but reject up to 8 candidates that fail `clearOf(dest, spectators.filter((o) => o !== s).map((o) => ({ x: o.fig.position.x, z: o.fig.position.z })), APRON.spacing)`.
- If `dest` exists: `const step = walkStep(s.fig.position, s.dest, 0.45, dt)`, apply `x`/`z`, set `s.baseYaw` toward the step with `faceYaw`, add a `walkT` accumulator for a taller bob (`0.035` idle, `0.07` walking), and on `arrived` set `dest = null` and `restT = rnd(1.2, 3.6)`.
- When paused, ease `baseYaw` back toward the board centre so talkers face the playfield.

Chat rules stay as they are, but gate new chatter on `dest === null` so figures do not chat while walking.

- [ ] **Step 4: Face the target when throwing**

In `throwWithSpectators`, before creating the job, set `s.baseYaw = faceYaw(s.fig.position, { x: cell.x + 0.5, z: cell.y + 0.5 })`. The existing release code reads `fig.position` and `fig.quaternion`, so the hand origin follows automatically.

- [ ] **Step 5: Verify in the browser**

Run this for roughly 20 seconds of frames:

```js
new Promise((res) => {
  const s = window.__snake.state();
  const seen = new Map();
  let frames = 0;
  const tick = () => {
    frames++;
    window.__snake.scene.traverse((o) => {
      if (!o.userData || !o.userData.isSpectator) return;
      const p = seen.get(o.uuid) || { minX: 1e9, maxX: -1e9, minZ: 1e9, maxZ: -1e9 };
      p.minX = Math.min(p.minX, o.position.x); p.maxX = Math.max(p.maxX, o.position.x);
      p.minZ = Math.min(p.minZ, o.position.z); p.maxZ = Math.max(p.maxZ, o.position.z);
      seen.set(o.uuid, p);
    });
    if (frames > 1200) {
      const moved = [...seen.values()].filter((p) => p.maxX - p.minX > 1.5 || p.maxZ - p.minZ > 1.5).length;
      res({ figures: seen.size, moved, board: [s.w, s.h] });
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})
```

Expected: `figures` 5, `moved` at least 4, and a screenshot showing at least one figure mid-walk away from the front row.

Then reset the round and confirm the walk state is cleared:

```js
(() => {
  window.__snake.reset();
  let figures = 0, sprites = 0;
  window.__snake.scene.traverse((o) => {
    if (o.userData && o.userData.isSpectator) figures++;
    if (o.isSprite && o.visible) sprites++;
  });
  return { figures, sprites, apples: window.__snake.state().apples.length };
})()
```

Expected: `figures` 5, `sprites` 0 (no avatar or bubble left over), `apples` 0 on the fresh round.

- [ ] **Step 6: Commit**

```bash
git add src/game.js
git commit -m "feat: let the rim crowd walk the apron"
```

### Task 5: Throw and chat polish

**Files:**
- Modify: `src/game.js` (`updateSpectators`, `throwWithSpectators`)

- [ ] **Step 1: Keep bubbles readable while walking stops**

Ensure an active bubble keeps the speaker paused: in the idle branch, if `bubbleT > 0`, skip movement and keep `restT` at its current value. (A speaker mid-step would otherwise slide out from under its own bubble.)

- [ ] **Step 2: Hide the talking arm wave when throwing**

The throw branch already owns `arm.rotation.x`; confirm no idle wave line runs after it in the same frame, and that the post-throw settle returns the arm to `0`.

- [ ] **Step 3: Verify end to end**

With sound on and random gifts off, send one apple and one bomb from the page (`window.__snake.sendGift('apple')`, `window.__snake.sendGift('bomb')`) from a fresh round with no bombs on the board, then assert:
- `window.__snake.state().apples.length` grew by 1 and `state.bombs.length` grew by 1 (free cells exist).
- At least one sprite with `scale.x < 1` was visible during the throw (avatar).
- No `error` events on `window`.
- `node --test` passes.

- [ ] **Step 4: Commit**

```bash
git add src/game.js
git commit -m "fix: keep the crowd readable during throws and chat"
```

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-24-rim-crowd-and-scenery.md`.
