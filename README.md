# Gift Snake 3D

A pastel 3D snake game built for vertical live streams. Viewers send gifts to feed the snake, drop bombs, and change its speed while an AI keeps the round moving.

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
| `T` | Cycle the colour theme |
| `R` | Restart the round |

Gold, silver, and bronze gifters persist across rounds. Repeated gifts from the same viewer within four seconds build a combo multiplier up to 5x.

## Rules

- The board is 12 x 13 cells. Filling every cell wins the round.
- Bombs land on the board like apples and only act when the snake eats one, cutting two segments (never below the minimum length). A bomb is not a board object while it is falling, so it cannot be eaten or targeted until it lands; if it lands on the snake it flies into the mouth and detonates there. The AI goes for a safe route to a bomb before an apple. During a rescue the snake cannot move, so a bomb detonates on drop instead and frees it.
- The AI is beatable: it occasionally misjudges a move and starts playing greedily for the rest of the round, which is how a round can be lost. Roughly one round in eight ends in a crash.
- The AI follows a precomputed fill order cell by cell, so the body draws one clean pattern (concentric rings) instead of a body cut by shortcuts. Every move keeps the tail reachable by construction, so following the order cannot trap the snake. Apples and bombs are eaten when the order reaches them rather than chased off-pattern.
- Filling the board starts a 10 second victory lap with a large countdown: the snake keeps moving, the length stops changing, and a bomb cut during the lap cancels the pending win. When the clock runs out the round shows STREAMER WINS, counts 3 seconds, and restarts by itself.
- A self-collision starts a 10 second rescue window. Viewers can free the snake with a bomb; otherwise the round ends.
- After a crash the next round starts automatically after 3 seconds.
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
