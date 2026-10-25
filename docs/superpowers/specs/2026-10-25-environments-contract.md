# Environments Contract (2026-10-25)

Goal: replace the nine flat colour palettes with five full staged environments —
Beach, Football, Dungeon, Garden, Space. Each environment sets the whole look:
backdrop wash, fog, lights, board colours, ground texture, apron scenery props,
and one cheap ambient motion layer. `T` cycles environments; a new round advances
to the next one, same as the palettes did.

This file is the interface contract. Do not change it without telling the other
workers; every module below is owned by exactly one worker.

## Module boundary

| File | Owner | Depends on |
| --- | --- | --- |
| `src/environments.js` | worker A | nothing (pure data) |
| `src/apron.js` | worker A | nothing (pure math) |
| `src/environment-art.js` | worker B | `three` only |
| `src/game.js` | worker C | A + B outputs |
| `index.html`, `README.md` | worker D | contract text only |

Nobody but the named owner edits that file. Tests: `test/environments.test.js`
(worker A), `test/apron.test.js` (worker A).

## `src/environments.js`

Plain ES module, no Three.js, no DOM.

```js
export const ENVIRONMENT_IDS = ['beach', 'football', 'dungeon', 'garden', 'space'];
export const GROUND_KINDS = ['sand', 'pitch', 'stone', 'grass', 'star'];
export const AMBIENT_KINDS = ['waves', 'flag', 'torches', 'fireflies', 'planet'];
export const PROP_KINDS = [
  // beach
  'palm', 'parasol', 'sandcastle', 'shell',
  // football
  'goalpost', 'cone', 'ball', 'bench',
  // dungeon
  'torch', 'bones', 'barrel', 'stalagmite',
  // garden
  'bush', 'flower', 'tree', 'birdbath',
  // space
  'crater', 'spaceflag', 'crystal', 'satellite',
];

export const ENVIRONMENTS = [
  {
    id: 'beach',            // one of ENVIRONMENT_IDS
    name: 'Beach',          // HUD label, shown upper-case by game.js
    dark: false,            // true => add data-theme="dark" to <html>
    ambient: 'waves',       // one of AMBIENT_KINDS
    ground: 'sand',         // one of GROUND_KINDS
    css: { cyan, magenta, lime, orange, blue, violet, amber }, // hud accents, same keys as today
    sceneTop: '#bfe9f7',    // backdrop gradient top
    sceneBottom: '#f6e6c4', // backdrop gradient bottom
    base: '#3f7f86', baseEm: '#4d97a0', grid: '#c8f0f2',
    wall: '#f0d6a4', wallEm: '#dcb87a', post: '#fff8ea', postEm: '#f2dcb4',
    head: '#ffc247', accent: '#ffd98a', rim: '#7fe3ff',
    dots: 0.22,             // ground texture opacity (named `dots` to match existing code)
    fog: 0.008,             // FogExp2 density
    keyLight: '#fff1d6', keyIntensity: 2.4,
    ambientLight: '#ffe9c9', ambientIntensity: 0.6,
    props: ['palm', 'parasol', 'sandcastle', 'shell'], // subset of PROP_KINDS
  },
  // football, dungeon, garden, space: same shape, in this order
];

export function environmentAt(index) {
  const n = ENVIRONMENTS.length;
  return ENVIRONMENTS[((index % n) + n) % n];
}
```

Rules:

- Order is Beach, Football, Dungeon, Garden, Space.
- Every colour is a `#rrggbb` string. `dark` is true for the stages whose
  3D backdrop is dark enough to need the dark HUD surfaces: Football, Dungeon
  and Space.
- `groundTint` tints the tiling ground texture; it must stay readable against
  the board base so the apron reads as stage floor.
- `props` lists 4 kinds, and every list entry must exist in `PROP_KINDS`.
- `ground` must exist in `GROUND_KINDS`; `ambient` in `AMBIENT_KINDS`.
- `fog` stays in the 0.006–0.014 range so the apron and crowd stay readable.

Mood guide:

- **Beach** — sand, warm sun, turquoise water, palm silhouettes.
- **Football** — night stadium: desaturated turf green, white line paint, cool
  floodlight, pale sodium rim.
- **Dungeon** — torch-lit stone: near-black backdrop, warm ember key, violet rim.
- **Garden** — daylight lawn and flowers, fresh green, warm rim.
- **Space** — deep violet-black, magenta nebula backdrop, cyan rim, cold key.

## `src/apron.js`

Keep everything exported today (`APRON`, `apronPoint`, `walkStep`, `faceYaw`,
`clearOf`, `segmentClear`, `sceneryLayout`) and the current default behaviour.
Only change:

```js
export const SCENERY_KINDS = ['bush', 'rock', 'flower', 'crate'];

export function sceneryLayout(w, h, rand = Math.random, count = 14, kinds = SCENERY_KINDS) {
  // same body, but item.kind drawn from `kinds`
}
```

An empty `kinds` array must still produce items: fall back to `SCENERY_KINDS`.

## `src/environment-art.js`

Three.js side. Imports `* as THREE from 'three'` directly (the page import map
resolves `three`). No DOM access except `document.createElement('canvas')` for
textures, same as `src/game.js` already does. MeshToonMaterial look: geometry
from primitives, flat colours, no external assets, no new dependencies.

```js
// One apron prop. Unknown kind throws Error(`unknown prop: ${kind}`).
export function createProp(kind)            // -> THREE.Group, base sits on y=0

// Tiling ground texture. Unknown kind throws Error(`unknown ground: ${kind}`).
// Must set wrapS = wrapT = THREE.RepeatWrapping and anisotropy = 4.
export function groundTexture(kind)         // -> THREE.CanvasTexture

// Ambient dressing for one environment, sized to the current board.
// Unknown kind throws Error(`unknown ambient: ${kind}`).
export function createAmbient(kind, w, h)   // -> { group, update(t), dispose() }
```

`createAmbient` requirements:

- `group` is a `THREE.Group` the caller adds to the scene.
- `update(t)` takes seconds and only nudges transforms/materials — no allocation,
  no new geometry per frame.
- `dispose()` releases every geometry/material/texture the group created.
- Keep it outside the board: props sit on or beyond the apron ring
  (`src/apron.js` puts things at `x < 0.6 || x > w - 0.6`, `z > h + 0.7` for the
  near band, plus the far band behind `z < 0`). Nothing may cover a board cell.

Prop briefs (all toon-flat, built from primitives):

- `palm` — leaning trunk (3 tapered cylinders) + 5 fronds (flattened cones/boxes).
- `parasol` — pole + striped cone canopy + tiny base.
- `sandcastle` — two stacked cylinders + 4 crenellation boxes + flag.
- `shell` — flattened low-poly sphere with a fan of ridges (3 flattened boxes).
- `goalpost` — H-frame: two posts, crossbar, two net panels (thin boxes).
- `cone` — orange cone + white band + flat square base.
- `ball` — icosahedron sphere + 2 pentagon-ish dark patches.
- `bench` — seat plank, back plank, 4 legs; pale team colours.
- `torch` — wall-free standing post, iron cup, ember cone, warm point light.
- `bones` — 2 crossed long bones (cylinder + sphere ends) on a small mound.
- `barrel` — cylinder body + 2 hoop rings + lid.
- `stalagmite` — 3 stacked cones, grey-violet.
- `bush` — 3 lobes (reuse the current bush recipe).
- `flower` — stem + head + 2 leaves; brighter than today.
- `tree` — trunk + 3 crown lobes, taller than a bush.
- `birdbath` — pedestal + shallow dish + water disc.
- `crater` — ring of 6 flattened rocks around a dark disc.
- `spaceflag` — pole + cloth panel + emissive star disc.
- `crystal` — 3 emissive octahedra at different tilts.
- `satellite` — body box + 2 solar panels + dish.

Ambient briefs:

- `waves` — a wide water plane behind the board (negative z) with a scrolling
  stripe texture; `update` moves the map offset. Do not cover the apron.
- `flag` — 4 corner flags on the apron diagonals; `update` sways the cloth.
- `torches` — 2 ember posts flanking the near corners; `update` flickers the
  flame scale and a warm point light.
- `fireflies` — 10 small emissive spheres over the apron, drifting on sin paths.
- `planet` — a large sphere plus ring far behind and above the board;
  `update` rotates it slowly.

## `src/game.js` integration

- Delete the `THEMES` array; import `ENVIRONMENTS`, `environmentAt` and
  `createProp`, `groundTexture`, `createAmbient`.
- Rename `themeIndex` → `envIndex`, `applyTheme` → `applyEnvironment` (update the
  three call sites). Keep the HUD element ids (`#stat-theme`, `#stat-theme-btn`).
- `paintBackdrop(top, bottom)` takes both stops. Initial call and every env swap
  pass `sceneTop` / `sceneBottom`. Keep `bgTex` reuse.
- Per swap set: css vars, `data-theme` for `dark`, fog colour + density, ambient
  light colour/intensity, key light colour/intensity, rim light colour,
  `scene.background` wash, board materials, `groundMat` colour/opacity/texture
  (dispose the previous map), snake colour, checker, HUD label, aria-label.
- Scenery: replace the local `PROP_FACTORIES` with `createProp`, and pass
  `th.props` into `sceneryLayout`. Keep the `sceneryGroup` rebuild and the
  `layoutScenery()` call order inside `layoutBoard()`.
- Ambient: module-level `let ambient = null`; `layoutAmbient()` disposes the old
  one and builds `createAmbient(th.ambient, state.w, state.h)`. Call it from
  `applyEnvironment` and from `layoutBoard` (board resize must re-fit ambient).
- Render loop: call `ambient?.update(elapsedSeconds)` once per frame. Use the
  existing clock/elapsed value if present, else track one.
- Keep `window.__snake` shape; add `setEnvironment(index)` only if it helps the
  visual verification, and document it.
- Old bushes/rocks/crates/flower constructors may be deleted once `createProp`
  covers them; do not leave dead code.

## `index.html` / `README.md`

- HUD chip still reads `T` and shows the name; change any user-facing "theme" or
  "palette" wording to "environment" only where it describes the `T` cycle.
- README: replace the nine-palettes line in Controls with the five environments,
  and update the Rules bullet about palette advance. Keep every other rule.

## Acceptance

- `npm test` passes.
- Each environment renders without console errors; no prop or ambient mesh covers
  a board cell; scenery stays on the apron.
- `T` cycles Beach → Football → Dungeon → Garden → Space → Beach; a new round
  advances once; dark stages add and remove `data-theme` cleanly.
- No new dependency, no build step.
