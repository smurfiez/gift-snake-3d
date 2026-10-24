# Stats Header, Per-Round Theme, Gift Menu Icons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the top brand bar with a session stats card, rotate the theme every round, and turn the gift table into a TikTok-style gift menu with icon tiles.

**Architecture:** All UI lives in `index.html` (markup + CSS, no build step). `src/game.js` renders the values into the new DOM nodes, keeps session totals in `localStorage`, and advances the theme inside `reset()`. Gift icons are local SVG files in `assets/gifts/`, referenced from the existing `.gift` buttons.

**Tech Stack:** Static ES modules, Three.js 0.160 via import map, `node --test` for pure logic, built-in browser tools for visual checks.

**Spec:** User requests from session 2026-10-24 with the reference screenshot: stacked WINS/LOSS/APPLES/BOMBS stats block at the top of the stage, a gift list with one icon per gift, and a new theme on each run.

## Global Constraints

- No build step, no npm dependencies, no CDN for icons. Icons are local files.
- "Actual TikTok gifts": this plan ships original SVG stand-ins in TikTok gift style. Exact TikTok artwork is copyrighted; if you hold licensed PNGs, drop 96×96 transparent files into `assets/gifts/` with the same filenames and nothing else changes.
- Keep `window.__snake` shape unchanged. Keep every existing keyboard shortcut (1–6, T, R, D).
- Keep the nine palettes and `applyTheme(index)` unchanged in behaviour.
- Session totals persist across reloads under `giftsnake.totals`; a corrupt value must not break boot.
- Existing `#hud-apples` / `#hud-bombs` stay as per-round counters. Wins and losses move to the header.
- Do not touch `src/logic.js`, `src/apron.js`, or their tests.

## Review Focus

- **Stored totals garbage** — non-numeric, negative, or missing fields must load as zeros, not NaN; test in Task 1.
- **Totals double-count** — increments must fire once per eaten apple / eaten bomb, not per frame or per render.
- **Theme advances on manual restart** — `R` and automatic restarts must both rotate; the debug menu must not rotate.
- **New header collides with the debug panel** — the debug panel opens top-left; the stats card needs its own corner slot or the debug panel moves.
- **Icon missing or blocked** — a missing file must degrade to the emoji, not an empty box.
- **Narrow viewport** — the stats card must not cover the board's top rows at the `@container (max-width: 640px)` breakpoint.

---

### Task 1: Session totals and stats card

**Files:**
- Create: `src/totals.js`
- Test: `test/totals.test.js`
- Modify: `index.html` (`.stage-hud` markup + CSS), `src/game.js` (totals load/save/render, eat increments)

**Interfaces:**
- `export function normaliseTotals(raw: unknown): { apples: number, bombs: number }` — accepts anything, returns two non-negative finite integers, zeros for bad fields. Wins and losses keep coming from the existing `record` store.
- `export function bumpTotals(totals, field: 'apples'|'bombs', n = 1): void` — mutates in place, clamps at zero.

- [ ] **Step 1: Write failing tests** in `test/totals.test.js`:

```js
// normaliseTotals({}) -> { apples: 0, bombs: 0 }
// normaliseTotals(null) -> { apples: 0, bombs: 0 }
// normaliseTotals({ apples: '12', bombs: -4 }) -> { apples: 12, bombs: 0 }
// normaliseTotals({ apples: Infinity, bombs: 3.7 }) -> { apples: 0, bombs: 4 }
// bumpTotals({ apples: 1, bombs: 0 }, 'apples', 3) -> apples 4
// bumpTotals(totals, 'bombs', -5) clamps at 0
```

- [ ] **Step 2: Run** `node --test test/totals.test.js`; expect `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement `src/totals.js`.** `Math.trunc`, `Number.isFinite`, `Math.max(0, ...)` per field; `bumpTotals` uses the same clamp.

- [ ] **Step 4: Replace the header markup** in `index.html`:

```html
<header class="stage-hud">
  <section class="stats" aria-label="Session stats">
    <div class="stats-row"><span>WINS</span><b id="stat-wins">0</b></div>
    <div class="stats-row"><span>LOSS</span><b id="stat-losses">0</b></div>
    <div class="stats-row"><span>APPLES</span><b id="stat-apples">0</b></div>
    <div class="stats-row"><span>BOMBS</span><b id="stat-bombs">0</b></div>
    <div class="stats-foot"><span id="stat-theme">STRAWBERRY</span><kbd class="key">T</kbd></div>
  </section>
</header>
```

Style `.stats` as a translucent rounded card: dark surface in the dark theme, white surface in light; rows `display:flex; justify-content:space-between`; numbers tabular and bold; width `clamp(120px, 17cqw, 210px)`. Remove `.brand` and `.live` rules that become unused. Move the debug panel down (`top`) so it does not overlap the card, or place the card top-left and debug top-right.

- [ ] **Step 5: Wire totals in `src/game.js`.** Add `const TOTALS_KEY = 'giftsnake.totals'`, load through `normaliseTotals` inside a `try`, save through `JSON.parse`-safe helper. Replace the `hud.wins` / `hud.losses` writes in `refreshRecord` with `hud.statWins` / `hud.statLosses`. Increment `totals.apples` where `res.ate` is handled and `totals.bombs` where `res.bomb` is handled, then call `renderTotals()`. Remove the wins/losses row from the SCOREBOARD panel markup; per-round `APPLES EATEN` / `BOMBS EATEN` stay.

- [ ] **Step 6: Verify.** `node --test` green. In the browser: totals start from stored values; eating an apple grows APPLES by one and survives a reload; the header does not overlap the debug panel or the board at the narrow breakpoint.

- [ ] **Step 7: Commit** only `index.html`, `src/game.js`, `src/totals.js`, `test/totals.test.js`.

### Task 2: Theme rotates every round

**Files:**
- Modify: `src/game.js` (`reset`, boot, `#stat-theme` text), `index.html` only if the theme chip id changes.

- [ ] **Step 1: Rotate in `reset()`** — call `applyTheme((themeIndex + 1) % THEMES.length)` at the end of `reset()`, after `layoutBoard()` so the board repaint uses the new palette. Do not rotate on boot; the first round keeps theme 0.
- [ ] **Step 2: Update the stats chip** — `applyTheme` writes the palette name into `#stat-theme` (uppercase) in addition to the removed `#theme` button. Keep `T` calling `applyTheme(themeIndex + 1)`.
- [ ] **Step 3: Verify** — three restarts in the browser cycle three different palettes and the chip text follows; a widen gift restart also rotates; `T` still cycles without restarting.
- [ ] **Step 4: Commit** only `src/game.js`.

### Task 3: Gift icons

**Files:**
- Create: `assets/gifts/rose.svg`, `bomb.svg`, `bolt.svg`, `snail.svg`, `widen.svg`, `taller.svg`
- Modify: `index.html` (`.gift` markup + CSS)

- [ ] **Step 1: Draw six SVGs** at `viewBox="0 0 96 96"`, transparent background, flat TikTok-gift look: rose bloom + leaf, round bomb with fuse, lightning bolt, snail shell, left-right arrows, up-down arrows. Two-tone fills with a light rim highlight; keep the game palette family (`#ff6b8a`, `#39f6ff`, `#9dff3d`, `#ffc14d`, `#b99cff`, `#ff8a3d`).
- [ ] **Step 2: Replace the emoji icons** — each `.gift-ico` becomes `<img class="gift-img" src="assets/gifts/<name>.svg" alt="" width="96" height="96" />` inside the existing tile. Keep the emoji as a sibling fallback hidden via `onerror` (inline handler sets `img.hidden = true` and reveals a `.gift-fallback` span). CSS: `.gift-img { width: clamp(34px, 4.4cqw, 56px); height: auto; }`.
- [ ] **Step 3: Verify** — all six icons load (Network 200, no broken images); disable one file temporarily and confirm the emoji fallback appears; menu still sends the right gift on click and 1–6.
- [ ] **Step 4: Commit** only `index.html` and the six SVGs.

### Task 4: Compact deck, gift rows, final check

**Files:**
- Modify: `index.html` (`.deck`, `.score`, `.gifts`, `.gift` CSS and the SCOREBOARD markup)
- Modify: `src/game.js` (`hud.apples` / `hud.bombs`, `refreshHud`)
- Modify: `README.md`

Controller decision for this task (overrides Task 1 keeping the per-round counters):
- Apples and bombs are now shown once, in the header. Remove the per-round `APPLES EATEN` / `BOMBS EATEN` row from the SCOREBOARD panel, drop the `#hud-apples` / `#hud-bombs` DOM nodes, remove those handles from the `hud` object, and reduce `refreshHud()` to whatever still needs it (if nothing, delete the function and its call sites).
- Shrink the bottom deck: `--deck-h` from `34%` to `24%` and trim panel padding so the gift rows still fit without scrolling. The SCOREBOARD panel keeps only the TOP GIFTERS list.

- [ ] **Step 1: Remove the duplicate counters** per the decision above. Check every `hud.apples` / `hud.bombs` / `refreshHud` reference; boot must not throw.
- [ ] **Step 2: Compact the deck** — `--deck-h: 24%`, smaller `.deck` padding and `.score`/`.gifts` gaps; verify the six gift tiles and the top-gifter list still fit at the shipped aspect and at the narrow breakpoint.
- [ ] **Step 3: Reskin the gift tiles** as screenshot-style rows: icon tile on the left in a rounded translucent square, gift name bold, effect as the second line, key badge on the right. Keep the two-column grid and the `data-gift` attributes.
- [ ] **Step 4: README** — update the Controls section for the header stats, per-round theme, and local SVG icon stand-ins.
- [ ] **Step 5: Full verification** — `node --test`; browser: header readable, deck not clipped, six icons, one apple and one bomb gift still land, theme changes on restart, no console errors.
- [ ] **Step 6: Commit** `index.html`, `src/game.js`, `README.md`.
