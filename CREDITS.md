# Credits

## Sound effects

Most sampled effects in `assets/sfx/` come from
[Mixkit](https://mixkit.co/free-sound-effects/) and are used under the Mixkit
Free License (free for commercial and personal projects, no attribution
required). The apple bite and the keyboard click come from
[Freesound](https://freesound.org/) under CC0 (public domain).

| File | Source | License |
| --- | --- | --- |
| `eat.mp3` | https://freesound.org/people/Anthousai/sounds/398756/ | CC0 |
| `bomb.mp3` | https://freesound.org/people/wubitog/sounds/200466/ | CC0 |
| `crash.mp3` | https://mixkit.co/free-sound-effects/impact/ (asset 1143) | Mixkit |
| `win.mp3` | https://mixkit.co/free-sound-effects/win/ (asset 1928) | Mixkit |
| `click.mp3` | https://freesound.org/people/StavSounds/sounds/766611/ | CC0 |

Each file is trimmed to the useful part of the source recording and
loudness-normalised for the game.

The game still synthesises its other effects (gift drops, speed, slow, error,
key clicks) with Web Audio, so it works with no assets at all.

## 3D

Three.js is loaded from a CDN through the import map in `index.html`.
