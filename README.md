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
- The AI chases apples along a real shortest path, but only over moves that keep the snake's own escape route intact: after each move the tail must still be reachable, the free space must stay connected, and the head must keep room to manoeuvre. When no direct route passes, it falls back to a Hamiltonian cycle walk, which cannot trap the snake and always fills the board. It sometimes picks a safe route that reads as a near-miss, but never one that fails the check, and it never deliberately dies.
- Filling the board starts a 10 second victory lap with a large countdown: the snake keeps moving, the length stops changing, and a bomb cut during the lap cancels the pending win. When the clock runs out the round shows STREAMER WINS, counts 3 seconds, and restarts by itself.
- A self-collision starts a 10 second rescue window. Viewers can free the snake with a bomb; otherwise the round ends.
- After a crash the next round starts automatically after 3 seconds.

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
