# Eight-Stage Rules Extension (2026-10-26)

Extension to `2026-10-25-environments-contract.md`. That file describes the
original five-stage contract and is kept as history; it is not rewritten here.
This file records the three stages added since then and the gift-rule ids they
introduced.

Source of truth: `src/environments.js`, consumed by `src/logic.js` and
`src/game.js`.

## Cycle order

`ENVIRONMENT_IDS`:

1. `beach`
2. `football`
3. `dungeon`
4. `garden`
5. `space`
6. `volcano`
7. `arctic`
8. `city`

`environmentAt(index)` wraps over all eight.

## Per-stage rules

| Stage | `appleRule` | `bombRule` |
| --- | --- | --- |
| Beach | `pair` | `tide` |
| Football | `pass` | `kick` |
| Dungeon | `fade` | `barrel` |
| Garden | `vine` | `compost` |
| Space | `twin` | `gravity` |
| Volcano | `drift` | `erupt` |
| Arctic | `slide` | `freeze` |
| Neon City | `blink` | `emp` |

`single` and `static` stay in `APPLE_RULES` / `BOMB_RULES` as defaults; no
stage uses them.

## Rule behaviour

Apple rules (`spawnGiftApples`, `updateStageApples`):

- `pair`: spawns the dropped apple plus one extra apple on a free orthogonal neighbour.
- `pass`: moves the dropped apple to the far end of the reachable run ahead of the head.
- `fade`: the apple expires 7 seconds after it lands.
- `vine`: the gift apple plants one extra apple on the nearest free cell about 2.2 seconds after landing.
- `twin`: adds a mirror copy at `(w - 1 - x, h - 1 - y)` when that cell is free.
- `slide`: the dropped apple skids along the snake's current direction until the next cell is blocked.
- `drift`: every ~1.8 seconds each landed apple moves one free orthogonal cell, preferring the cell closest to the board centre.
- `blink`: every ~4 seconds each landed apple teleports to a random free cell.

Bomb rules (`primeBomb`, `advanceBombs`, `detonateVisual`):

- `tide`: after a 3-tick warmup, drifts up to three cells toward the head on the dominant axis and stops.
- `kick`: after a 2-tick warmup, rolls along its stored direction; a wall or occupied cell stops it, the snake detonates it.
- `barrel`: rolls like `kick` but reverses direction on a wall or occupied cell and keeps bouncing.
- `compost`: cuts the tail, then plants two apples on the nearest free cells.
- `gravity`: cuts the tail, then pulls every apple one cell toward the blast.
- `erupt`: cuts the tail, then spawns one extra static bomb on a free cell when under the three-bomb cap.
- `freeze`: cuts the tail, then adds 20 ms to the tick interval (capped at 400 ms), slowing the snake.
- `emp`: cuts the tail, then moves every apple to a new random free cell.

Every stage bomb still applies the base cut of two segments, never below the
minimum length.

## New stage art kinds

| Stage | `ground` | `ambient` | `props` |
| --- | --- | --- | --- |
| Volcano | `lava` | `embers` | `lavapool`, `obsidian`, `geyser`, `ashrock` |
| Arctic | `ice` | `snow` | `igloo`, `icecrystal`, `snowman`, `sled` |
| Neon City | `neon` | `traffic` | `streetlamp`, `hydrant`, `billboard`, `newsbox` |

These extend `GROUND_KINDS`, `AMBIENT_KINDS` and `PROP_KINDS` in
`src/environments.js`; each `props` list still holds four kinds, and every
ground/ambient value still belongs to its exported kind list.
