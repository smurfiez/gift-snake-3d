# Gift Snake 3D

A pastel 3D snake game built for vertical live streams. Viewers send gifts to feed the snake, drop bombs, and change its speed while an AI keeps the round moving. The board is viewed from a slight isometric tilt, and the food is cel-shaded to match the snake.

## Run locally

```sh
python3 -m http.server 5199
```

Open <http://localhost:5199/index.html>.

No build step is required. Three.js loads from a CDN through the import map in `index.html`.

## Controls

| Input | Action |
| --- | --- |
| `1` | Apple: drop fruit; Beach and Space drop two |
| `2` | Bomb: drop a bomb on the board; the snake eats it to lose two segments |
| `3` | Speed up |
| `4` | Slow down |
| `5` | Widen: board +2 columns (max 24) and restart the round |
| `6` | Taller: board +2 rows (max 25) and restart the round |
| `T` | Cycle the eight environments: Beach, Football, Dungeon, Garden, Space, Volcano, Arctic, Neon City |
| `R` | Restart the round |
| `D` | Debug menu: victory lap, sound, random gifts, speed multiplier |

Gold, silver, and bronze gifters persist across rounds. Repeated gifts from the same viewer within four seconds build a combo multiplier up to 5x.

The stats card at the top left shows session totals: wins, losses, apples eaten, and bombs eaten. They are stored in the browser and survive a reload. Each new round advances to the next environment automatically; `T` cycles the environments by hand, and the environment chip in the stats card does the same on click or tap. An environment sets the backdrop wash, lights, board colours, ground, apron props, and one ambient motion layer. The gift icons are original local SVGs in `assets/gifts/`, drawn in a flat gift-art style rather than taken from the platform; each one falls back to its emoji if the file fails to load.

### Stage rules

| Stage | Apple | Bomb |
| --- | --- | --- |
| Beach | Surf pair: arrives as two apples | Tide bomb: drifts up to three cells toward the snake head, then stops |
| Football | Long pass: lands far down the snake's path | Penalty kick: rolls straight until it hits a wall or the snake |
| Dungeon | Fading treasure: disappears after about 7 seconds | Barrel bomb: rolls and bounces off walls until eaten or it hits the snake |
| Garden | Vine sprout: the gift apple grows one extra apple nearby after about 2 seconds | Compost bomb: cuts the tail and sprouts two apples |
| Space | Twin apples: a mirror copy appears across the board centre | Gravity bomb: cuts the tail and pulls every apple one cell toward the blast |
| Volcano | Rolling ember: moves one free cell toward the middle about every 2 seconds | Eruption bomb: cuts the tail and can spit out one extra static bomb |
| Arctic | Sliding fruit: skids along the snake's current direction until a wall or object stops it | Freeze bomb: cuts the tail and slows the snake |
| Neon City | Glitch apple: blinks to a free cell about every 4 seconds | EMP bomb: cuts the tail and teleports every apple to a new free cell |

The stage rule line under the bomb counter in the stats card names the current pair. Each new round moves on to the next environment.

## TikTok gifts (local bridge)

The page opens `ws://127.0.0.1:8765` only when the `TikTok gifts` debug toggle is on. Nothing connects while the toggle is off. The Node bridge in `server/bridge.mjs` joins a TikTok LIVE room and forwards each gift combo to the page as it arrives. For the full protocol, mapping rules and failure behaviour, see [`docs/tiktok-gift-integration.md`](docs/tiktok-gift-integration.md).

Setup:

```sh
npm install
TIKTOK_USER=@yourhandle npm run bridge
```

Add `TIKTOK_SESSION_ID` only if the sign server asks for an authenticated session. Then serve the page and enable the toggle.

To test without going live, run the fake feed in a second terminal:

```sh
npm run feed
npm run feed Rose 3
```

The fake feed sends the gift catalog on connect and then one gift every two seconds. The first form cycles through the catalog; the second sends three Roses and stays open. `--every <ms>` changes the cadence and `--once` sends one gift and exits. Stop the bridge first, or set `PORT` to move the fake feed.

Gifts are matched by `giftId` through a seed table keyed by gift name in `src/tiktok.js`. On connect the bridge prints the room catalog with each gift's id, name, and coin value. Paste those ids into `GIFT_MAP` and delete `SEED` once the ids are known. Unmapped gifts are ignored and counted in the debug chip as `ignored N`; click the chip to print the unknown ids.

The bridge uses the unofficial TikTok API, so it can break when TikTok changes its protocol. The connection is read-only. A combo is capped at three effects per combo.

## Rules

- The board starts at 16 x 17 cells and the snake moves at 5 cells per second. Filling every cell wins the round. A widen or taller gift grows the board and restarts the round on the new size, because the body order belongs to the old board; the growth lasts only for that round, and the next round returns to the default board. The board never gets narrower.
- Sound effects are sampled from Mixkit (`assets/sfx/`); the rest of the audio stays synthesised, so the game still works if the files are missing. See `CREDITS.md`.
- Bombs land on the board like apples and cut two segments when eaten (never below the minimum length). Some bombs move before they settle, some detonate on body contact, and several have an on-eat twist, so read the stage rules above for the current environment; the base cut and segment rules still apply everywhere. A bomb is not a board object while it is falling, so it cannot be eaten or targeted until it lands. If its target cell is taken, it lands on a free cell; only a board with no free cell sends it into the mouth to detonate. The bitten-off tail blows apart. The AI goes for a safe route to a bomb before an apple.
- The AI is beatable: it occasionally misjudges a move and starts playing greedily for the rest of the round, which is how a round can be lost. Roughly one round in eight ends in a crash.
- The AI follows an evolving concentric fill order, allowing the snake to build concentric rings, twin co-rotating hubs, triple concentric hubs, and quad quadrant bullseyes. To feel like an attentive human player rather than a rigid bot, the snake cuts across adjacent concentric rings with smooth momentum-biased arcs when an apple or bomb is physically nearby, takes tight inner-ring concentric coiling chords while small, and dynamically shifts between concentric pattern families mid-round whenever its body aligns with a shared arc. Bombs win a tie against apples and also land nearer the head. The chase switches off once the board is nearly full, so the closing cells are never stranded. Every accepted move keeps the tail reachable.
- The pattern family and variant are randomized each round across 32 topological variations (Single Bullseye, Twin Rings, Triple Hubs, Quad Bullseyes, and reflections) while preventing consecutive rounds from repeating the same variant. Each round also randomizes the snake's starting hub/position and rolls a distinct per-round human play-style profile (coiling cadence, tight vs. deep chord preference, shortcut reach, and L-turn momentum bias), and the snake continuously evaluates seamless mid-round pattern transitions so the play never feels repetitive or robotic.
- The header stats card counts apples and bombs eaten once for the whole session. On a win, the three-second countdown shows the top apple and bomb gifters of that round; the SCOREBOARD panel lists only those top gifters.
- On a full board (or during the victory lap) a gift apple takes the tail cell, so the snake shortens by one. When every cell is blocked by apples or bombs but the board is not full, the drop has nowhere to land and ends the round as a tail crash (a loss). Procedural apples only use free cells, so they stop during the victory lap or on a full board and resume once space clears.
- Apples and bombs are placed on the path just ahead of the head, so the snake goes for them within a second or two. It cannot chase an item that is off the order: skipping a cell there leaves a hole that only a full lap can recover.
- Filling the board starts a 10 second victory lap with a large countdown: the snake keeps moving, the length stops changing, and a bomb cut during the lap cancels the pending win. When the clock runs out the round shows STREAMER WINS, counts 3 seconds, and restarts by itself.
- A self-collision ends the round immediately as a normal crash: there is no rescue window and no way to buy the snake back.
- After a crash the next round starts automatically after 3 seconds.
- Sound can be switched off from the debug menu; that setting is stored in the browser and survives a reload. The other debug toggles (victory lap, random gifts, speed) are stored the same way.
- The header stats card keeps a running wins / losses record across rounds; it is stored in the browser so it survives a reload. Only a real win or a real crash counts — `R` abandons the round without scoring.

## Tests

```sh
npm test
```

The logic tests cover movement, pathfinding, gifts, self-collisions, and board sizing.

### Simulation

```sh
node scripts/sim.mjs 500
```

The seeded simulation plays 500 rounds of normal play with no gifts and reports win rate, wall and self deaths, slips, mean time to the first apple, and close-call rate. Acceptance: wins between 80% and 95% (the snake is meant to lose sometimes), and no round may run forever without winning or dying.

## Notes

This version is a local simulation. The TikTok bridge is optional and off by default; the game plays the same without it.
