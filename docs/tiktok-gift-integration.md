# TikTok Gift Integration

How a TikTok LIVE gift travels from the app to an effect on the board.

The game ships as a static page. A separate Node process (the *bridge*) joins the
LIVE room, folds gift combos, and republishes them on a local WebSocket. The page
only opens that socket when the `TikTok gifts` debug toggle is on, so the game
plays identically with no bridge running.

```
TikTok LIVE ──▶ bridge (Node, server/bridge.mjs)
                  │  tiktok-live-connector
                  │  normalize + combo fold (server/normalize.mjs)
                  ▼
        ws://127.0.0.1:8765  (JSON messages)
                  ▼
        feed client (src/tiktok.js, in the page)
                  │  giftId ─▶ effect
                  ▼
        sendGift(effect, viewer, count) (src/game.js)
                  │
                  ▼
        board effect + score + leaderboard + summary
```

## Components

| Piece | File | Job |
| --- | --- | --- |
| Bridge | `server/bridge.mjs` | Connects to one LIVE room, fetches the gift catalog from the unsigned gift list, prints status and gift combos over WebSocket. |
| Normaliser | `server/normalize.mjs` | Turns raw connector payloads into one stable gift shape and folds combo increments into a single event. |
| Feed client | `src/tiktok.js` | WebSocket client, reconnect loop, gift-id mapping, unknown-gift counter. |
| Effect dispatcher | `src/game.js` (`sendGift`) | Applies the effect to the board, particles, audio, scoring and toasts. |
| Fake feed | `scripts/feed.mjs` | Local stand-in for the bridge with the same message protocol. |
| Tests | `test/normalize.test.js` | Covers normalisation, combo folding and catalog parsing. |

## Message protocol

All messages are JSON text over `ws://127.0.0.1:8765`. The bridge binds
`127.0.0.1` only; it is never exposed to the network.

**Bridge → page, sent on every new connection**

```json
{ "t": "catalog", "gifts": [ { "id": 5655, "name": "Rose", "coins": 1 } ] }
{ "t": "status", "state": "live", "detail": "@yourhandle" }
```

`state` is `offline`, `connecting` or `live`. `detail` is a short free-text hint
(handle, error message, `disconnected`, `stream ended`).

**Bridge → page, per finished gift combo**

```json
{
  "t": "gift",
  "giftId": 5655,
  "name": "Rose",
  "count": 3,
  "coins": 3,
  "user": { "uniqueId": "nova", "nickname": "Nova" }
}
```

`count` is the cumulative combo size at the moment the combo ended, not the
increment. `coins` is the gift's diamond value times the count.

**Page → bridge**

```json
{ "t": "ping" }
```

Answered with a fresh `status` message. Nothing else is sent upstream; the
connection is read-only towards TikTok.

## No sign server required

The WebSocket join is unsigned, so no Euler key is needed. Only the connector's
`enableExtendedGiftInfo` option is paywalled: it fetches `gift/list` through the
sign server. The bridge turns that option off and fetches the same list directly
from TikTok's unsigned `webcast/gift/list` endpoint, then builds its own
`id → name` table. That keeps gift names and the seed mapping working with zero
external services.

If TikTok ever gates the unsigned list, the fallback is page capture in a
headless browser (listen to the live page's own WebSocket and decode the gift
messages), not a paid plan.

## Combo folding

TikTok emits one event per combo increment, each carrying a running
`repeatCount`, so a 100-rose combo produces 100 events. `createComboFolder()`
drops every event whose `repeatEnd` is false and keeps the last one, which
already reports the full count. The bridge therefore broadcasts one message per
combo instead of one per tap.

The bridge keeps one folder per connection, so a reconnect cannot inherit a
half-finished combo.

## Gift id → effect mapping

Effect names are the same keys the game already uses for keyboard gifts:
`apple`, `bomb`, `speed`, `slow`, `widen`, `taller`.

Resolution order in `src/tiktok.js`:

1. `GIFT_MAP` — explicit `giftId → effect`. Checked first.
2. `SEED` — a table keyed by gift **name** (case-insensitive, trimmed). When the
   catalog arrives, each catalog gift whose name matches a seed name is mapped
   by its id for the rest of the session.
3. No match → the gift is ignored, counted, and shown in the debug chip.

Gift ids are stable per gift but differ between rooms and regions, which is why
the seed matches on names and why ids should be frozen once known:

```js
export const GIFT_MAP = {
  5655: 'apple',
  5827: 'bomb',
};
```

Once real ids are in `GIFT_MAP`, delete `SEED`; pasted ids win regardless of
order.

Seed effects shipped today:

| Gift name | Effect |
| --- | --- |
| Rose, Finger Heart, TikTok, Hand Hearts | `apple` |
| Ice Cream Cone | `speed` |
| Doughnut | `slow` |
| Corgi, Galaxy, Lion, Universe | `bomb` |
| Sunglasses | `widen` |
| Cap | `taller` |

A combo applies at most **3** effect units (`MAX_PER_COMBO`). The feed client
calls `onGift(effect, viewerName, applied)` once per combo and the page loops
`applied` times through `sendGift`.

Unmapped gifts increment the `ignored` counter. The last 20 unknown gifts are
kept; clicking the status chip in the debug panel prints them with
`console.table`, ready to paste into `GIFT_MAP`.

## What each effect does

| Effect | Board behaviour |
| --- | --- |
| `apple` | Queues an apple for that viewer, flushed after 450 ms, so rapid taps batch into one drop. Gift apples may take the tail cell on a full board. |
| `bomb` | Drops a bomb on the path ahead; it only cuts the snake when eaten. Up to 3 bombs on the board; an over-cap bomb lands on the snake and detonates. |
| `speed` | Shortens the move interval by `speedStep` (15 ms), down to `minTick` 80 ms. |
| `slow` | Lengthens the interval by `slowStep` (20 ms), up to `maxTick` 400 ms. |
| `widen` | Grows the board by 2 columns (max 24), then restarts the round on the new size. |
| `taller` | Grows the board by 2 rows (max 25), then restarts the round on the new size. |

Growth cannot happen under a running body, so `widen` and `taller` always
restart the round, exactly like `R`. The size holds for that round only.

## Scoring, combos and summaries

- Base points: apple 10, bomb 25, speed 15, slow 10, widen 30, taller 30.
- Points = base × gift-apple unit count × viewer combo multiplier.
- A viewer's multiplier grows by 1 for each gift inside a 4-second window,
  capped at 5×.
- A crashed round scores nothing, and a reset keeps viewer scores.
- The SCOREBOARD panel lists the top 3 viewers of the session (stored in
  memory, cleared on reload).
- On a win, the countdown summary lists the top apple and bomb gifters **of that
  round**.

## Viewer identity

`user.nickname || user.uniqueId || 'viewer'` from the bridge. Names are passed
through untouched, so emoji and non-Latin scripts survive to the toasts and
leaderboard. Keyboard and simulated gifts use the local `VIEWERS` list instead.

## Setup

```sh
npm install
TIKTOK_USER=@yourhandle npm run bridge
python3 -m http.server 5199
```

Environment variables for the bridge:

| Name | Meaning |
| --- | --- |
| `TIKTOK_USER` | Required. LIVE account handle; a leading `@` is stripped. |
| `PORT` | Local WebSocket port, default `8765`. |
| `TIKTOK_SESSION_ID` | Optional cookie session for authenticated sockets. |
| `TIKTOK_TARGET_IDC` | Optional region id that belongs with the session. |
| `TIKTOK_SIGN_API_KEY` | Optional Euler Stream API key used to sign the WebSocket URL. Without it the free sign route is refused with "This endpoint requires a Business plan". |

Then open the page, press `D`, and enable `TikTok gifts`. The toggle is stored in
`localStorage` under `giftsnake.debug` and survives a reload; the socket only
opens while it is on.

## Local testing without going live

```sh
npm run feed            # one arbitrary gift every 2 s
npm run feed Rose 3     # three Roses at once, then stay connected
node scripts/feed.mjs --once   # one gift, print it, exit
```

Stop the real bridge first, or change `PORT` for one of them. The fake feed
speaks the same protocol, including `catalog` and `status`, and cycles through
the seed gift names so every mapped effect can be exercised.

Keyboard shortcuts `1`–`6` cover the same effects with no bridge at all.

## Connection and failure behaviour

Page side (`src/tiktok.js`):

- Retries every 3 seconds while the toggle is on and the socket is closed.
- A deliberate toggle-off closes the socket and cancels the retry, so nothing
  reconnects behind the streamer's back.
- The bridge's own `status` wins while the socket is open; otherwise the socket
  state decides. The debug chip shows `off`, `connecting…`, `live`, `offline`,
  plus `· ignored N` when gifts were dropped.
- An unreachable bridge logs one warning per offline transition, not per retry.

Bridge side (`server/bridge.mjs`):

- Reconnects 5 seconds after `disconnected`, `streamEnd` or a failed connect.
- A failed gift parse is logged and skipped; it never kills the bridge.
- `SIGINT` disconnects the TikTok client and closes the WebSocket server.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Chip stays `offline` | Bridge not running, wrong port, or toggle off | Start `npm run bridge`, check `PORT`, re-enable the toggle. |
| Chip shows `live` but gifts do nothing | Gift ids unmapped for this room | Click the chip, read the unknown ids, add them to `GIFT_MAP`. |
| `ignored N` climbs | Same as above, or viewers send gifts outside the map | Map the ids, or accept the drops. |
| Bridge exits at start | `TIKTOK_USER` missing | Pass the handle: `TIKTOK_USER=@name`. |
| Connect fails with a session error | Missing `TIKTOK_TARGET_IDC` for the session cookie | Set it, or drop `TIKTOK_SESSION_ID` and try anonymous. |
| Gifts arrive late or not at all after a while | TikTok changed the unofficial API | Update `tiktok-live-connector`; the integration itself needs no change. |
| `This endpoint requires a Business plan` | Extended gift info was switched on; that route is paid | Leave `enableExtendedGiftInfo: false`; the bridge builds the catalog from the unsigned gift list. |

## Known limits

- The connector is an unofficial client for TikTok's internal API. A protocol
  change can break room joining; the game keeps running, the chip goes
  `offline`.
- The gift catalog comes from the unsigned `gift/list` route. If TikTok gates
  that route, catalog names disappear first; gift ids still arrive, so mapping
  can fall back to a hardcoded `GIFT_MAP` until a page-capture bridge lands.
- Effects are capped at 3 units per combo so a large gift cannot flood the
  board.
- The client mapping layer has no unit test because it owns a WebSocket; the
  protocol shape it depends on is covered by `test/normalize.test.js`.
- Gift scores live in memory only. Reloading the page clears the session
  scoreboard, while the wins/losses record and debug toggles persist in
  `localStorage`.
