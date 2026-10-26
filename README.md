# Gift Snake 3D

A pastel 3D snake game built for vertical live streams. Viewers send gifts to feed the snake, drop bombs, and change its speed while an AI keeps the round moving. The board is viewed from a slight isometric tilt, and the food is cel-shaded to match the snake.

## Run locally

```sh
python3 -m http.server 9010
```

Open <http://localhost:9010/index.html>.

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
| `I` | Open the stage guide: every stage's apple, bomb, passive and event rules |
| `R` | Restart the round |
| `D` | Debug menu: victory lap, sound, random gifts, speed multiplier |

Gold, silver, and bronze gifters persist across rounds; there is no combo multiplier.

The stats card at the top left shows wins and losses for the session, plus the apples and bombs eaten on the current stage. Wins and losses are stored in the browser and survive a reload; the apple and bomb counters clear whenever the environment changes. Each new round advances to the next environment automatically; `T` cycles the environments by hand, and the environment chip in the stats card does the same on click or tap. An environment sets the backdrop wash, lights, board colours, ground, apron props, and one ambient motion layer. The gift icons are original local SVGs in `assets/gifts/`, drawn in a flat gift-art style rather than taken from the platform; each one falls back to its emoji if the file fails to load.

Press `I` or use the `i` button in the stats card to open the stage guide. It lists all eight stages with their difficulty, apple rule, bomb rule, passive and set-piece event, and marks the stage currently on screen. The guide is a readable overlay; the round keeps running behind it. `Esc` or the close button returns to the game.

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

### Stage meter, events and passives

Gifts charge a per-round meter. The meter label names the next event, and a full meter fires that event once and resets the meter to zero. An apple charges 10, a bomb 14, speed or slow 8, and widen or taller 25.

Each stage also runs a passive on its own timer and owns one set-piece event:

| Stage | Passive | Passive effect | Event | Event effect |
| --- | --- | --- | --- | --- |
| Beach | Tide | Loose apples drift one cell toward the sea | Tide Surge | Sweeps every bomb one cell and plants three apples at the centre |
| Football | End Zone | Apples roll one cell downfield | Goal Rush | Plants up to four apples in one end-zone row pair |
| Dungeon | Torchlight | Pulses the lights and marks the nearest apple with a spark burst | Vault Opens | Plants a ring of up to six apples around the snake head |
| Garden | Bloom | The first two apples each sprout one neighbour | Full Bloom | The first five apples each sprout one neighbour |
| Space | Gravity Well | Pulls every apple one cell toward the board centre | Meteor Shower | Scatters landing apples, adds two apples and tries to add one static bomb |
| Volcano | Fissure | Shoves the nearest bomb up to two cells toward the head axis | Eruption | Drops up to three fresh static bombs |
| Arctic | Black Ice | Slides loose apples one extra cell along the snake's heading | Blizzard | Adds 40 ms to the tick for 5 seconds |
| Neon City | Crosswalk | Shoves apples one cell away from the board centre | Blackout | Shuffles every bomb and dims the stage lights for 4 seconds |

Round-start speed, meter goal and passive interval follow a three-step difficulty. Calm runs a 210 ms tick, a 90 meter and a 7 second passive; Brisk runs 200 ms, 100 and 6 seconds; Wild runs 185 ms, 110 and 5 seconds. Beach, Football and Garden are Calm, Dungeon, Space and Arctic are Brisk, and Volcano and Neon City are Wild. Those tick values are the difficulty default, and a stage may ship a nearby tick instead: Football starts at 200 ms and Arctic at 210 ms.

Each stage opens with a 2 second intro card naming the stage number, its difficulty, the apple rule, the bomb rule, the passive and the next event. Eruption, Blackout and Meteor Shower telegraph for 1.2 seconds before they touch the board, so the warning lands before the change.

Each stage now has its own gift silhouettes: coconut, stitched ball, gold idol, peach, crystal, ember, ice pear and data chip, with a matching bomb for each. Stage ambience is a procedural loop synthesised from the shared `AudioContext` and crossfaded on a stage change, so these additions ship without new asset files.

## TikTok gifts (local bridge)

The page opens `ws://127.0.0.1:9090` only when the `TikTok gifts` debug toggle is on. Nothing connects while the toggle is off. The Python bridge in `server/bridge.py` joins a TikTok LIVE room, forwards each gift combo to the page as it arrives, and serves a panel at `http://127.0.0.1:9091` where each gift is mapped to a board effect. For the full protocol, mapping rules and failure behaviour, see [`docs/tiktok-gift-integration.md`](docs/tiktok-gift-integration.md).

Setup:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm install
source .venv/bin/activate
npm run bridge            # attaches to quwleqxr91m
```

It follows the `quwleqxr91m` room by default; `TIKTOK_USER=@other` switches handle. Every run is appended to `server/logs/bridge.log` with timestamps, so `tail -f server/logs/bridge.log` shows the gift history while streaming.

Add `TIKTOK_SESSION_ID` only if the sign server asks for an authenticated session, and `TIKTOK_SIGN_API_KEY` if the free sign route is rate limited. Then serve the page, enable the toggle, and open `http://127.0.0.1:9091` to choose which gift fires which effect. Saving in the panel applies to a running game without a reload.

The bridge retries a failed join three times, then stops. Press `D` for the debug menu: the **Room** field takes a new handle (blank keeps the current one) and `reconnect` restarts the attempts over the existing socket, so no process restart is needed.

To test without going live, run the fake feed in a second terminal:

```sh
npm run feed
npm run feed Rose 3
```

The fake feed sends the gift catalog on connect and then one gift every two seconds. The first form cycles through the catalog; the second sends three Roses and stays open. `--every <ms>` changes the cadence and `--once` sends one gift and exits. Stop the bridge first, or set `PORT` to move the fake feed.

Gifts are matched in `src/tiktok.js` in this order: the panel's saved table (pushed by the bridge as `{t:"rules"}`), then `GIFT_RULES` (explicit `giftId` → effect plus items per gift), then `GIFT_MAP` (older explicit ids), then `SEED`, a table keyed by gift name that the bridge catalog compiles to ids on connect. The shipped defaults are also the panel's starting table:

| Gift | ID | Effect | Items per gift |
| --- | --- | --- | --- |
| GG | 6064 | bomb | 5 |
| Finger Heart | 5487 | apple | 20 |
| Rosa | 8913 | bomb | 20 |
| Doughnut | 5879 | bomb | 50 |
| Paper Crane | 5659 | taller (board grows upwards) | 1 |
| Heart Me Flex | 10802 | widen (board grows sideways) | 1 |

A gift with no rule falls back to the name seed, and an apple-effect gift with no rule spawns 5 apples. A combo pays out once: the number of taps inside a combo does not multiply the item count. On connect the bridge prints the room catalog with each gift's id, name, coin value and current mapping, and the panel lists the same gifts with an effect dropdown. Unmapped gifts are ignored and counted in the debug chip as `ignored N`; click the chip to print the unknown ids.

The bridge uses the unofficial TikTok API, so it can break when TikTok changes its protocol. The connection is read-only. A message applies at most 3 combos (`MAX_PER_COMBO`), and each combo adds the gift's whole item count, so a 50-bomb gift lands as one volley.

## Rules

- The board starts at 16 x 17 cells and the snake moves at 5 cells per second. Filling every cell wins the round. A widen or taller gift grows the board and restarts the round on the new size, because the body order belongs to the old board; the growth lasts only for that round, and the next round returns to the default board. The board never gets narrower.
- Sound effects are sampled from Mixkit (`assets/sfx/`); the rest of the audio stays synthesised, so the game still works if the files are missing. See `CREDITS.md`.
- Bombs land on the board like apples and cut two segments when eaten (never below the minimum length). Some bombs roll before they settle, and several have an on-eat twist, so read the stage rules above for the current environment; the base cut and segment rules still apply everywhere. A moving bomb only ever enters an empty cell: the snake, an apple or another bomb blocks it exactly like a wall, so nothing detonates unless the snake eats it. A bomb is not a board object while it is falling, so it cannot be eaten or targeted until it lands. If its target cell is taken, it lands on a free cell; only a board with no free cell sends it into the mouth to detonate. The bitten-off tail blows apart. The AI goes for a safe route to a bomb before an apple.
- The AI is beatable: it occasionally misjudges a move and starts playing greedily for the rest of the round, which is how a round can be lost. Roughly one round in eight ends in a crash.
- The AI follows an evolving concentric fill order, allowing the snake to build concentric rings, twin co-rotating hubs, triple concentric hubs, and quad quadrant bullseyes. To feel like an attentive human player rather than a rigid bot, the snake cuts across adjacent concentric rings with smooth momentum-biased arcs when an apple or bomb is physically nearby, takes tight inner-ring concentric coiling chords while small, and dynamically shifts between concentric pattern families mid-round whenever its body aligns with a shared arc. Bombs win a tie against apples and also land nearer the head. The chase switches off once the board is nearly full, so the closing cells are never stranded. Every accepted move keeps the tail reachable.
- The pattern family and variant are randomized each round across 32 topological variations (Single Bullseye, Twin Rings, Triple Hubs, Quad Bullseyes, and reflections) while preventing consecutive rounds from repeating the same variant. Each round also randomizes the snake's starting hub/position and rolls a distinct per-round human play-style profile (coiling cadence, tight vs. deep chord preference, shortcut reach, and L-turn momentum bias), and the snake continuously evaluates seamless mid-round pattern transitions so the play never feels repetitive or robotic.
- The header stats card counts apples and bombs eaten on the current stage; both counters reset when the environment changes. Wins and losses stay on the session record. On a win, the three-second countdown shows the top apple and bomb gifters of that round; the SCOREBOARD panel lists only those top gifters.
- On a full board (or during the victory lap) a gift apple takes the tail cell, so the snake shortens by one. When every cell is blocked by apples or bombs but the board is not full, the drop has nowhere to land and ends the round as a tail crash (a loss). Procedural apples only use free cells, so they stop during the victory lap or on a full board and resume once space clears.
- Apples and bombs are placed on the path just ahead of the head, so the snake goes for them within a second or two. It cannot chase an item that is off the order: skipping a cell there leaves a hole that only a full lap can recover.
- Filling the board starts a 10 second victory lap with a large countdown: the snake keeps moving, the length stops changing, and a bomb cut during the lap cancels the pending win. When the clock runs out the round shows STREAMER WINS, counts 3 seconds, and restarts by itself.
- A self-collision ends the round immediately as a normal crash: there is no rescue window and no way to buy the snake back.
- After a crash the next round starts automatically after 3 seconds.
- Sound can be switched off from the debug menu; that setting is stored in the browser and survives a reload. The other debug toggles (victory lap, random gifts, speed) are stored the same way.
- The header stats card keeps a running wins / losses record across rounds; it is stored in the browser so it survives a reload. Only a real win or a real crash counts — `R` abandons the round without scoring.

## Tests

```sh
npm test          # game logic + page-side gift mapping
npm run test:bridge   # Python bridge: table validation, saved file, catalog
```

The logic tests cover movement, pathfinding, gifts, self-collisions, and board sizing. The bridge tests need the venv from the setup above.

### Simulation

```sh
node scripts/sim.mjs 500
```

The seeded simulation plays 500 rounds of normal play with no gifts and reports win rate, wall and self deaths, slips, mean time to the first apple, and close-call rate. Acceptance: wins between 80% and 95% (the snake is meant to lose sometimes), and no round may run forever without winning or dying.

## Notes

This version is a local simulation. The TikTok bridge is optional and off by default; the game plays the same without it.
