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
| `1` | Apple: spawn one apple |
| `2` | Bomb: drop a bomb on the board; the snake eats it to lose two segments |
| `3` | Speed up |
| `4` | Slow down |
| `5` | Widen: board +2 columns (max 24) and restart the round |
| `6` | Taller: board +2 rows (max 25) and restart the round |
| `T` | Cycle the nine colour palettes, including a dark stream theme |
| `R` | Restart the round |
| `D` | Debug menu: victory lap, sound, random gifts, speed multiplier |

Gold, silver, and bronze gifters persist across rounds. Repeated gifts from the same viewer within four seconds build a combo multiplier up to 5x.

The stats card at the top left shows session totals: wins, losses, apples eaten, and bombs eaten. They are stored in the browser and survive a reload. Each new round advances to the next colour palette automatically; `T` cycles the palettes by hand. The gift icons are original local SVGs in `assets/gifts/`, drawn in a flat gift-art style rather than taken from the platform; each one falls back to its emoji if the file fails to load.

## Rules

- The board starts at 12 x 13 cells and the snake moves at 5 cells per second. Filling every cell wins the round. A widen or taller gift grows the board and restarts the round on the new size, because the body order belongs to the old board; the growth lasts only for that round, and the next round returns to the default board. The board never gets narrower.
- Sound effects are sampled from Mixkit (`assets/sfx/`); the rest of the audio stays synthesised, so the game still works if the files are missing. See `CREDITS.md`.
- Bombs land on the board like apples and only act when the snake eats one, cutting two segments (never below the minimum length). A bomb is not a board object while it is falling, so it cannot be eaten or targeted until it lands; if it lands on the snake, or the board already holds three bombs, it flies into the mouth and detonates there. The bitten-off tail blows apart. The AI goes for a safe route to a bomb before an apple. During a rescue the snake cannot move, so a bomb detonates on drop instead and frees it.
- The AI is beatable: it occasionally misjudges a move and starts playing greedily for the rest of the round, which is how a round can be lost. Roughly one round in eight ends in a crash.
- The AI follows an evolving concentric fill order, allowing the snake to build concentric rings, twin co-rotating hubs, triple concentric hubs, and quad quadrant bullseyes. To feel like an attentive human player rather than a rigid bot, the snake cuts across adjacent concentric rings with smooth momentum-biased arcs when an apple or bomb is physically nearby, takes tight inner-ring concentric coiling chords while small, and dynamically shifts between concentric pattern families mid-round whenever its body aligns with a shared arc. Bombs win a tie against apples and also land nearer the head. The chase switches off once the board is nearly full, so the closing cells are never stranded. Every accepted move keeps the tail reachable.
- The pattern family and variant are randomized each round across 32 topological variations (Single Bullseye, Twin Rings, Triple Hubs, Quad Bullseyes, and reflections) while preventing consecutive rounds from repeating the same variant. Each round also randomizes the snake's starting hub/position and rolls a distinct per-round human play-style profile (coiling cadence, tight vs. deep chord preference, shortcut reach, and L-turn momentum bias), and the snake continuously evaluates seamless mid-round pattern transitions so the play never feels repetitive or robotic.
- The scoreboard counts apples and bombs eaten in the header stats card, once for the whole session. On a win, the three-second countdown shows the top apple and bomb gifters of that round.
- A gift apple is never refused: with no free cell it takes the tail cell, so the snake shortens by one. Procedural apples only use free cells, so they stop during the victory lap or on a full board and resume once space clears.
- Apples and bombs are placed on the path just ahead of the head, so the snake goes for them within a second or two. It cannot chase an item that is off the order: skipping a cell there leaves a hole that only a full lap can recover.
- Filling the board starts a 10 second victory lap with a large countdown: the snake keeps moving, the length stops changing, and a bomb cut during the lap cancels the pending win. When the clock runs out the round shows STREAMER WINS, counts 3 seconds, and restarts by itself.
- A self-collision starts a 5 second rescue window. Viewers can free the snake with a bomb; otherwise the round ends.
- After a crash the next round starts automatically after 3 seconds.
- Sound can be switched off from the debug menu; that setting is stored in the browser and survives a reload. The other debug toggles (victory lap, random gifts, speed) are stored the same way.
- The scoreboard keeps a running wins / losses record across rounds; it is stored in the browser so it survives a reload. Only a real win or a real crash counts — a rescue that a bomb frees is not a loss, and `R` abandons the round without scoring.

## Tests

```sh
npm test
```

The logic tests cover movement, pathfinding, gifts, the rescue state, and board sizing.

### Simulation

```sh
node scripts/sim.mjs 500
```

The seeded simulation plays 500 rounds of normal play with no gifts and reports win rate, wall and self deaths, rescues, slips, mean time to the first apple, and close-call rate. Acceptance: wins between 80% and 95% (the snake is meant to lose sometimes), and no round may run forever without winning or dying.

## Notes

This version is a local simulation. It does not connect to TikTok Live yet.
