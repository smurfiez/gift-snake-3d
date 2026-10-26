# TikTok Gift Integration

How a TikTok LIVE gift travels from the app to an effect on the board.

The game ships as a static page. A separate Python process (the *bridge*) joins
the LIVE room, folds gift combos, republishes them on a local WebSocket, and
serves a panel where you decide which effect each gift triggers. The page only
opens that socket when the `TikTok gifts` debug toggle is on, so the game plays
identically with no bridge running.

```
TikTok LIVE ──▶ bridge (Python, server/bridge.py)
                  │  TikTokLive v7
                  │  combo fold + gift list (server/gift_effects.py)
                  ▼
        ws://127.0.0.1:9090  (JSON messages)
                  ▼
        feed client (src/tiktok.js, in the page)
                  │  giftId ─▶ effect
                  ▼
        sendGift(effect, viewer, count) (src/game.js)
                  │
                  ▼
        board effect + score + leaderboard + summary
```

The mapping table is owned by the bridge, not the page:

```
panel (http://127.0.0.1:9091) ──POST /api/rules──▶ server/gift-effects.json
                                                       │
                                      {t:"rules"} broadcast
                                                       ▼
                                             src/tiktok.js (wins over the
                                             baked-in GIFT_RULES tables)
```

## Components

| Piece | File | Job |
| --- | --- | --- |
| Bridge | `server/bridge.py` | Connects to one LIVE room, fetches the gift catalog, folds combos, publishes status and gifts over WebSocket, serves the panel. |
| Gift table | `server/gift_effects.py` | Loads, validates and atomically saves the gift → effect table; normalises the catalog. |
| Panel | `server/panel.html` | Searchable gift list with an effect dropdown and item count per gift. Saving applies live. |
| Run log | `server/logs/bridge.log` | Every line the bridge prints, prefixed with a timestamp. Appended across runs. |
| Feed client | `src/tiktok.js` | WebSocket client, reconnect loop, mapping layers, unknown-gift counter. |
| Effect dispatcher | `src/game.js` (`sendGift`) | Applies the effect to the board, particles, audio, scoring and toasts. |
| Fake feed | `scripts/feed.mjs` | Local stand-in for the bridge with the same message protocol. |
| Tests | `test/test_gift_effects.py` | Covers table validation, the saved file round trip and catalog normalisation. |
| Tests | `test/tiktok.test.js` | Covers the page-side mapping order, including bridge rules winning over the baked-in tables. |

## Message protocol

All messages are JSON text over `ws://127.0.0.1:9090`. The bridge binds
`127.0.0.1` only; it is never exposed to the network.

**Bridge → page, sent on every new connection**

```json
{ "t": "catalog", "gifts": [ { "id": 5655, "name": "Rose", "coins": 1 } ] }
{ "t": "rules", "rules": { "6064": { "effect": "bomb", "count": 5 } } }
{ "t": "status", "state": "live", "detail": "@yourhandle" }
```

`state` is `offline`, `connecting` or `live`. `detail` is a short free-text hint
(handle, error message, `disconnected`, `stream ended`).

`rules` is also pushed whenever the panel saves, so an open page retunes without
a reload.

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

**Bridge → page, per comment, like, join, follow or share**

```json
{ "t": "interaction", "kind": "comment", "user": { "uniqueId": "nova", "nickname": "Nova" }, "text": "hi snake" }
{ "t": "interaction", "kind": "like", "count": 7, "user": { "uniqueId": "kito", "nickname": "Kito" } }
```

`kind` is one of `comment`, `like`, `join`, `follow`, `share`. `text` only
appears on comments, collapsed to one line and cut at 120 characters. `count`
only appears on likes and is the size of that like batch. The page turns a
`kind` into a board effect only when the panel maps it; an unmapped kind is
dropped silently, so the `ignored` counter stays about gifts.

`status` also carries `user`, the handle the bridge is joined to, so the page can
show the current room.

**Page → bridge**

```json
{ "t": "ping" }
{ "t": "reconnect", "user": "@handle" }
```

`ping` is answered with a fresh `status` message. `reconnect` points the bridge
at another handle and starts a new retry budget; an empty `user` reconnects to
the current room. The debug menu's Room field sends exactly this message.
Nothing else is sent upstream; the connection is read-only towards TikTok.

## Signing and the gift catalog

TikTokLive v7 asks the Euler Stream sign server for the WebSocket URL. The free
route works without a key and is rate limited; set `TIKTOK_SIGN_API_KEY` to raise
the limit. The bridge exports it as `SIGN_API_KEY`, the name TikTokLive reads.

The catalog is separate: `gift/list/` is served unsigned, so the bridge fetches
it directly and builds its own `id → name` table. No paid gift-info route is
used, and no key is needed to name gifts.

If TikTok ever gates the unsigned list, catalog names disappear first; gift ids
still arrive, so saved rules and the baked-in tables keep working.

## Combo folding

TikTok emits one event per combo increment, each carrying a running
`repeat_count`, so a 100-rose combo produces 100 events. The bridge drops every
event whose `repeat_end` is false and forwards the last one, which already
reports the full count. The page therefore hears one message per combo instead
of one per tap.

## Interactions: comments, likes, joins, follows, shares

The bridge subscribes to five more room events and forwards each as an
`interaction` message, logged the same way gifts are:

| Kind | TikTokLive event | Carries | Log line |
| --- | --- | --- | --- |
| `comment` | `CommentEvent` | `text` | `comment @nova "hi snake" -> …` |
| `like` | `LikeEvent` | `count` (batch size) | `like @nova x7 -> …` |
| `join` | `JoinEvent` | — | `join @nova -> …` |
| `follow` | `FollowEvent` | — | `follow @nova -> …` |
| `share` | `ShareEvent` | — | `share @nova -> …` |

Nothing fires until a kind is mapped. The panel lists the five kinds above the
gift catalog with the same effect dropdown and item count, and they are saved in
the same `server/gift-effects.json` under their name instead of a gift id:

```json
{
  "follow": { "effect": "apple", "count": 10 },
  "comment": { "effect": "speed", "count": 1 },
  "6064": { "effect": "bomb", "count": 5 }
}
```

An interaction pays out once per event, not once per viewer action inside it: a
10-like batch mapped to `apple` drops as many apples as the row's item count
says, and its `count` field is only logged, never multiplied. Likes are not
coalesced, so a busy room writes one log line and one socket message per like
batch; leave the kind unmapped to keep it quiet on the board.

## Gift id → effect mapping

Effect names are the same keys the game already uses for keyboard gifts:
`apple`, `bomb`, `speed`, `slow`, `widen`, `taller`. Each mapping also carries an
item count: how many board items one gift puts on the board.

Resolution order in `src/tiktok.js`:

1. **Bridge rules** — the table saved in the panel, delivered as `{t:"rules"}`.
   Checked first, so the panel always wins.
2. `GIFT_RULES` — the shipped ids in `src/tiktok.js`, used when no bridge is
   running.
3. `GIFT_MAP` — older explicit `giftId → effect` table, with no item count.
4. `SEED` — a table keyed by gift **name** (case-insensitive, trimmed). When the
   catalog arrives, each catalog gift whose name matches a seed name is mapped
   by its id for the rest of the session.
5. No match → the gift is ignored, counted, and shown in the debug chip.

A mapping with no count of its own leaves `count` empty: an `apple`-effect gift
then spawns 5 apples, every other effect applies once.

Shipped defaults, also the starting table in the panel:

| Gift | ID | Effect | Items per gift |
| --- | --- | --- | --- |
| GG | 6064 | `bomb` | 5 |
| Finger Heart | 5487 | `apple` | 20 |
| Rosa | 8913 | `bomb` | 20 |
| Doughnut | 5879 | `bomb` | 50 |
| Paper Crane | 5659 | `taller` (board grows upwards) | 1 |
| Heart Me Flex | 10802 | `widen` (board grows sideways) | 1 |

Seed effects shipped today:

| Gift name | Effect |
| --- | --- |
| Rose, Finger Heart, TikTok, Hand Hearts | `apple` |
| Ice Cream Cone | `speed` |
| Doughnut | `slow` |
| Corgi, Galaxy, Lion, Universe | `bomb` |
| Sunglasses | `widen` |
| Cap | `taller` |

Ids differ between rooms and regions, which is why the name seed stays as a
backstop for gifts without a rule. A gift pays out once per combo message: the
tap count inside a combo never multiplies the effect, so a 9-tap Doughnut still
asks for its 50 bombs.

Unmapped gifts increment the `ignored` counter. The last 20 unknown gifts are
kept; clicking the status chip in the debug panel prints them with
`console.table`, ready to map in the panel.

## The effect panel

`http://127.0.0.1:9091` while the bridge runs.

- The gift list comes from the live room, sorted by coin value. Search with `/`,
  filter to mapped or unmapped gifts.
- The five interaction kinds sit at the top of the same table, since they share
  the mapping file and the save path.
- Each row has an effect dropdown (`— none —` clears the mapping) and an item
  count. Counts are clamped to 1–999.
- **Save** writes the whole table to `server/gift-effects.json` and broadcasts it
  to every connected page. The game applies it immediately; no reload needed.
- Mappings whose gift is not in the current room stay listed as `Saved id`, so
  they survive a room change and can be cleared.
- The panel polls `/api/state` every 4 seconds for bridge status and a new
  catalog. Unsaved edits are never overwritten by a poll.

The table lives in this shape, safe to edit by hand while the bridge is stopped:

```json
{
  "6064": { "effect": "bomb", "count": 5 },
  "5487": { "effect": "apple", "count": 20 }
}
```

Invalid entries (unknown effect, non-numeric id, bad count) are dropped on load
and on save, and the bridge logs how many mappings it kept.

## What each effect does

| Effect | Board behaviour |
| --- | --- |
| `apple` | Queues apples for that viewer, flushed after 450 ms, so rapid taps batch into one drop. Each gift adds its item count: 20 for Finger Heart, 5 for any other apple gift. Gift apples may take the tail cell on a full board. |
| `bomb` | Queues a volley that lands in one drop, one bomb per item, each aimed at the path ahead; a bomb only cuts the snake when eaten. `CONFIG.maxBombs` is 60, so a 50-bomb gift fits; a bomb past the cap flies into the mouth and detonates. |
| `speed` | Shortens the move interval by `speedStep` (15 ms), down to `minTick` 80 ms. |
| `slow` | Lengthens the interval by `slowStep` (20 ms), up to `maxTick` 400 ms. |
| `widen` | Grows the board by 2 columns (max 24), then restarts the round on the new size. |
| `taller` | Grows the board by 2 rows (max 25), then restarts the round on the new size. |

Growth cannot happen under a running body, so `widen` and `taller` always
restart the round, exactly like `R`. The size holds for that round only.

## Scoring, combos and summaries

- Base points: apple 10, bomb 25, speed 15, slow 10, widen 30, taller 30.
- Points = base × item count. There is no viewer combo multiplier.
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
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # TikTokLive + websockets
npm install                                   # fake feed only
source .venv/bin/activate
npm run bridge                                # room: quwleqxr91m
python3 -m http.server 9010                   # page, second terminal
```

`npm run bridge` runs `python3 server/bridge.py`, so activate the venv first (or
point `python3` at it). The bridge follows the `quwleqxr91m` room unless
`TIKTOK_USER` names another handle.

Every run appends to `server/logs/bridge.log`, one timestamped line per status
change, catalog load and gift. Keep `tail -f server/logs/bridge.log` open next to
the terminal; the file survives restarts and is git-ignored.

Environment variables for the bridge:

| Name | Meaning |
| --- | --- |
| `TIKTOK_USER` | Optional. LIVE account handle; a leading `@` is stripped. Defaults to `quwleqxr91m`. |
| `PORT` | Local WebSocket port, default `9090`. |
| `PANEL_PORT` | Effect panel port, default `9091`. If it is busy the bridge walks to `9092`, `9093`, `9094` and prints the URL it took. |
| `GIFT_RULES_PATH` | Mapping file, default `server/gift-effects.json`. |
| `TIKTOK_SESSION_ID` | Optional cookie session for authenticated sockets. |
| `TIKTOK_TARGET_IDC` | Optional region id that belongs with the session. |
| `TIKTOK_SIGN_API_KEY` | Optional Euler Stream key; raises the sign-server rate limit. |

Then open the page, press `D`, and enable `TikTok gifts`. The toggle is stored in
`localStorage` under `giftsnake.debug` and survives a reload; the socket only
opens while it is on. Mapping lives in the panel at
`http://127.0.0.1:9091`, not in the game.

Always open the panel from the URL the bridge prints. A copy loaded from the
game's static server or from disk shows the panel but cannot save, because
`/api/state` and `/api/rules` do not exist on that server; the page says so in a
red banner.

## Local testing without going live

```sh
npm run feed                    # one arbitrary gift every 2 s
npm run feed Rose 3             # three Roses at once, then stay connected
node scripts/feed.mjs --once    # one gift, print it, exit
```

Stop the real bridge first, or change `PORT` for one of them. The fake feed
speaks the same protocol, including `catalog` and `status`, and cycles through
the seed gift names so every mapped effect can be exercised. It does not send
`rules`; the page keeps using its baked-in tables.

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

Bridge side (`server/bridge.py`):

- Retries 5 seconds after a disconnect, a finished stream or a failed connect,
  and gives up after 3 consecutive failures so the sign server is not hammered.
  A join that succeeds starts the budget over.
- After giving up the process stays up: the panel keeps serving and the debug
  menu's Room + `reconnect` starts a fresh round of attempts without a restart.
- A failed catalog fetch leaves rules intact; gifts arrive unnamed until the
  list loads. A failed gift parse cannot kill the bridge.
- `Ctrl-C` closes the WebSocket server, the panel and the TikTok client.
- The panel runs on a thread; saved rules hop back to the asyncio loop before
  they are broadcast, so a save never races a gift message.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Chip stays `offline` | Bridge not running, wrong port, or toggle off | Start `npm run bridge`, check `PORT`, re-enable the toggle. |
| Panel page will not load | Bridge crashed at start, or another app owns the panel port | Read its terminal output; it prints the port it took. Usually a missing venv. |
| Panel loads but Save fails | The page is not served by the bridge (game static server, disk copy), or the bridge stopped | Open the URL the bridge printed; the red banner names the cause. Restart `npm run bridge` if the banner says it is unreachable. |
| Panel lists no gifts | Room is live but the catalog fetch failed | The bridge logs `gift catalog fetch failed`; saved rules still apply. |
| Chip shows `live` but gifts do nothing | Gift ids unmapped for this room | Click the chip, read the unknown ids, map them in the panel. |
| `ignored N` climbs | Same as above, or viewers send gifts outside the map | Map the ids, or accept the drops. |
| Bridge exits at start | Python deps not installed, or the venv is not active | Run `.venv/bin/pip install -r requirements.txt` and activate the venv. |
| Connect fails with a session error | Missing `TIKTOK_TARGET_IDC` for the session cookie | Set it, or drop `TIKTOK_SESSION_ID` and try anonymous. |
| Gifts arrive late or not at all after a while | TikTok changed the unofficial API | Update `TikTokLive` and `websockets`; the integration itself needs no change. |
| `Too many connections started` | Sign-server free tier rate limit | Wait, or set `TIKTOK_SIGN_API_KEY`. |

## Known limits

- TikTokLive is an unofficial client for TikTok's internal API. A protocol
  change can break room joining; the game keeps running and the chip goes
  `offline`.
- The gift catalog comes from the unsigned `gift/list` route. If TikTok gates
  that route, catalog names disappear first; gift ids still arrive, so saved
  rules and the hardcoded tables keep working.
- The panel loads the room's catalog, so mapping a gift that is not in the
  current room means typing its id by hand into the JSON file.
- There is no combo multiplier: a gift combo pays out once, so a Doughnut asks
  for 50 bombs no matter how many taps it took, and `CONFIG.maxBombs` (60)
  settles how many stay.
- Interactions are forwarded as they arrive. A room that likes heavily writes
  one log line per like batch and one socket message per batch; there is no
  coalescing, so leave a kind unmapped when its volume would flood the board.
- Gift scores live in memory only. Reloading the page clears the session
  scoreboard, while the wins/losses record and debug toggles persist in
  `localStorage`. The mapping table persists on the bridge machine.
- `server/logs/bridge.log` appends for every run and is never rotated; delete it
  when it gets long.
