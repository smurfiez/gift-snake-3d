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
| `2` | Bomb: cut two segments, or free the snake during a rescue |
| `3` | Speed up |
| `4` | Slow down |
| `T` | Cycle the colour theme |
| `R` | Restart the round |

Gold, silver, and bronze gifters persist across rounds. Repeated gifts from the same viewer within four seconds build a combo multiplier up to 5x.

## Rules

- The board is 12 x 13 cells. Filling every cell wins the round.
- The AI chases apples along a real shortest path, but only over moves that keep the snake's own escape route intact: after each move the tail must still be reachable, the free space must stay connected, and the head must keep room to manoeuvre. When no direct route passes, it falls back to a Hamiltonian cycle walk, which cannot trap the snake and always fills the board. It sometimes picks a safe route that reads as a near-miss, but never one that fails the check, and it never deliberately dies.
- A self-collision starts a 10 second rescue window. Viewers can free the snake with bombs; otherwise the round ends.
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

The seeded simulation plays 500 rounds of normal play with no gifts and reports win rate, wall and self deaths, rescues, mean time to the first apple, and close-call rate. Acceptance target: wins >= 80%, zero self collisions, zero wall deaths, zero rescues.

## Notes

This version is a local simulation. It does not connect to TikTok Live yet.
