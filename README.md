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
- The AI always takes a reachable apple, even when that move is risky.
- A self-collision starts a 10 second rescue window. Viewers can free the snake with bombs; otherwise the round ends.
- After a crash the next round starts automatically after 3 seconds.

## Tests

```sh
npm test
```

The logic tests cover movement, pathfinding, gifts, the rescue state, and board sizing.

## Notes

This version is a local simulation. It does not connect to TikTok Live yet.
