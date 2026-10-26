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

## Stage meter and set pieces

Owned by `src/stage-rules.js` (data and arithmetic) and `src/game.js` (board
effects). One meter per round, one passive per stage, one event per stage.

Charge per gift (`GIFT_CHARGE`):

| Gift | Charge |
| --- | --- |
| `apple` | 10 |
| `bomb` | 14 |
| `speed` | 8 |
| `slow` | 8 |
| `widen` | 25 |
| `taller` | 25 |

`chargeStage` clamps to the stage goal and reports whether the charge grew.
`consumeStageEvent` returns `null` below the goal; at the goal it resets
`charge` to 0, increments `events`, and returns the stage event.
`setStageRound` keeps the stage id and goal in sync and clamps the charge.

Event table (`STAGE_META[id].event`, ids and labels):

| Stage | Event id | Label | Effect |
| --- | --- | --- | --- |
| Beach | `surge` | Tide Surge | Shifts every bomb one cell down and plants three apples at the centre |
| Football | `goal` | Goal Rush | Plants up to four apples in rows 0-1 or rows h-2..h-1 |
| Dungeon | `vault` | Vault Opens | `plantApples` ring of up to six apples around the head |
| Garden | `bloom` | Full Bloom | Each of the first five apples sprouts one neighbour |
| Space | `meteor` | Meteor Shower | Scatters landing apples, plants two apples, tries to add one static bomb |
| Volcano | `eruption` | Eruption | Spawns up to three static bombs on free cells |
| Arctic | `blizzard` | Blizzard | Adds 40 ms to the tick and reverts after 5 seconds |
| Neon City | `blackout` | Blackout | Moves every bomb to a free cell and dims key/ambient light for 4 seconds |

## Passive traits

`STAGE_META[id].passive` carries `id`, `label`, `text` and `every`. The interval
comes from `PASSIVE_SECONDS`; `advancePassive` adds frame time and reports
`due` once per call after the accumulated time reaches one interval, then
subtracts that interval.

| Stage | Passive id | Label | Board effect |
| --- | --- | --- | --- |
| Beach | `tide` | Tide | `shiftApples(0, -1)` |
| Football | `endzone` | End Zone | `shiftApples(0, 1)` |
| Dungeon | `torchlight` | Torchlight | Pulses the key light for 0.4 s and bursts at the nearest apple |
| Garden | `bloom` | Bloom | Each of the first two apples sprouts one neighbour |
| Space | `gravity` | Gravity Well | `pullApplesToward` the board centre |
| Volcano | `fissure` | Fissure | Shifts the nearest bomb up to two cells toward the head on the dominant axis |
| Arctic | `ice` | Black Ice | `shiftApples` along the snake's current direction |
| Neon City | `crosswalk` | Crosswalk | Shifts each apple one cell away from the board centre column |

## Difficulty curve

`DIFFICULTY_LABELS`: 1 = Calm, 2 = Brisk, 3 = Wild. `tickMs` is the shared
round-start tick from `STAGE_META`, also applied by `reset` and `init`.

| Difficulty | Tick ms | Meter goal | Passive seconds | Stages (actual tick) |
| --- | --- | --- | --- | --- |
| 1 Calm | 210 | 90 | 7 | Beach 210, Football 200, Garden 210 |
| 2 Brisk | 200 | 100 | 6 | Dungeon 200, Space 200, Arctic 210 |
| 3 Wild | 185 | 110 | 5 | Volcano 185, Neon City 185 |

Difficulty sets the meter goal and the passive interval. Each stage passes its
own `tickMs`, so the tick column is the group default and the parenthesised
values are the shipped numbers.

## Presentation

Intro card (`#stage-intro`) fades in on every stage change for 2 seconds and
shows `#stage-intro-kicker` (`STAGE n / 8 · DIFFICULTY`), `#stage-intro-name`,
`#stage-intro-apple`, `#stage-intro-bomb`, `#stage-intro-passive` and
`#stage-intro-event` (`Next event: <label>`). `aria-hidden` tracks the card.

Stage guide (`#stage-guide`, dialog) is available at any time from
`#stage-guide-btn` or the `I` key. `#stage-guide-list` is rebuilt from
`ENVIRONMENTS` plus `STAGE_META`, one item per stage with difficulty, apple and
bomb labels, passive and event text. The current stage gets
`.stage-guide-item.current` and `aria-current="true"`. `#stage-guide-close` or
`Escape` closes it and returns focus to the button. The guide does not pause the
round.

Meter ids: `#stage-meter`, `#stage-meter-label` (next event label, uppercase),
`#stage-meter-pct`, `#stage-meter-track`, `#stage-meter-fill`. The fill width is
`charge / goal`; the label never changes until the stage changes.

Telegraph: `eruption`, `blackout` and `meteor` ring-burst their target cells,
toast a warning, and apply the effect on a frame-clock timer 1.2 seconds later.
Their ring colours are `0xff4d3d`, `0x9ff6ff` and `0xff8a3d`.

Stage gift silhouettes come from `src/gift-art.js`
(`createStageApple`, `createStageBomb`): Beach coconut, Football stitched ball,
Dungeon gold idol, Garden peach, Space crystal, Volcano ember, Arctic ice pear,
Neon City data chip, each with a matching bomb. Geometry and materials are
built once at module load; no new asset files.

Stage ambience comes from `src/stage-audio.js` (`createStageAudio`): two to four
synthesised oscillator/noise sources per stage behind a bus gain, fed the shared
`AudioContext` through `setContext`, crossfaded over roughly 0.45 s by
`setStage`, and muted by `setEnabled`. No new asset files.
