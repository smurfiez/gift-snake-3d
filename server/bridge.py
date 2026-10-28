"""TikTok LIVE gift bridge, in Python.

Joins one LIVE room, folds gift combos, republishes them on a local WebSocket for
the game page, and serves a panel for mapping gift ids to board effects.

    python3 server/bridge.py            # room defaults to quwleqxr91m
    TIKTOK_USER=@someone python3 server/bridge.py

Game socket: ws://127.0.0.1:9090   Panel: http://127.0.0.1:9091
Run log:    server/logs/bridge.log
"""

import asyncio
import itertools
import json
import logging
import os
import sys
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import websockets
    from websockets.asyncio.server import serve
    from TikTokLive import TikTokLiveClient
    from TikTokLive.events import (
        CommentEvent,
        ConnectEvent,
        DisconnectEvent,
        FollowEvent,
        GiftEvent,
        JoinEvent,
        LikeEvent,
        LiveEndEvent,
        ShareEvent,
    )
except ImportError:
    sys.exit(
        "missing python deps: python3 -m pip install -r requirements.txt "
        "(or activate .venv first)"
    )

from gift_effects import (
    DEFAULT_COUNT,
    EFFECTS,
    load_rules,
    normalize_catalog,
    save_rules,
)

# The room the streamer maps gifts for; override with TIKTOK_USER.
DEFAULT_USER = "quwleqxr91m"
USER = (os.environ.get("TIKTOK_USER") or DEFAULT_USER).strip().lstrip("@")

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT") or 9090)
PANEL_PORT = int(os.environ.get("PANEL_PORT") or 9091)
CONFIG_PATH = os.environ.get("GIFT_RULES_PATH") or os.path.join(ROOT, "gift-effects.json")
SESSION_ID = (os.environ.get("TIKTOK_SESSION_ID") or "").strip()
TARGET_IDC = (os.environ.get("TIKTOK_TARGET_IDC") or "").strip()
SIGN_API_KEY = (os.environ.get("TIKTOK_SIGN_API_KEY") or "").strip()
if SIGN_API_KEY:
    # TikTokLive reads this name itself when it builds its signer.
    os.environ["SIGN_API_KEY"] = SIGN_API_KEY
RETRY_DELAY = 5
# Repeated joins burn the sign server's rate limit, so stop asking after this.
MAX_RETRIES = 3

# One file per machine keeps the stream history after the terminal scrolls away.
LOG_PATH = os.path.join(ROOT, "logs", "bridge.log")
handlers = [logging.StreamHandler(sys.stdout)]
try:
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    handlers.append(logging.FileHandler(LOG_PATH, encoding="utf-8"))
except OSError as exc:
    print(f"log file disabled ({exc}), logging to the terminal only")
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=handlers,
)
log = logging.info
# These clients log every request URL and socket frame at INFO; the bridge's own
# lines are the interesting ones.
for noisy in ("httpx", "httpcore", "websockets", "websockets.server"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

STATE = {
    "status": {"state": "offline", "detail": "starting"},
    "catalog": [],
    "rules": load_rules(CONFIG_PATH),
}
GIFT_NAMES = {}
CLIENTS = set()
LOOP = None
# The loop can be restarted by a reconnect request, so its client, task and a
# generation counter live here rather than inside the coroutine.
ROOM = {"generation": 0, "client": None, "task": None, "failures": 0, "wake": None}
# The panel polls /api/events?since=N; a bounded buffer keeps that cheap.
FEED = deque(maxlen=100)
FEED_SEQ = itertools.count(1)


# ---------- state plumbing ----------

def panel_state():
    """Snapshot for the panel; safe to call from the HTTP thread."""
    return {
        **STATE,
        "user": USER,
        "effects": list(EFFECTS),
        "defaultCount": DEFAULT_COUNT,
        "configPath": CONFIG_PATH,
    }


def record_event(key, kind, label, who, count=None):
    """One feed line, resolved against the rule table at the moment it arrived."""
    rule = STATE["rules"].get(str(key))
    entry = {
        "id": next(FEED_SEQ),
        "at": time.strftime("%H:%M:%S"),
        "kind": kind,
        "label": label,
        "user": who["uniqueId"],
        "count": count,
        "effect": rule["effect"] if rule else None,
        "items": rule["count"] if rule else None,
    }
    FEED.append(entry)
    return entry


def feed_since(since):
    events = [event for event in list(FEED) if event["id"] > since]
    return {"seq": events[-1]["id"] if events else since, "events": events}


def encode(msg):
    return json.dumps(msg, ensure_ascii=False)


async def send(ws, msg):
    try:
        await ws.send(encode(msg))
    except websockets.ConnectionClosed:
        CLIENTS.discard(ws)


async def broadcast(msg):
    for ws in list(CLIENTS):
        await send(ws, msg)


async def broadcast_rules(rules):
    STATE["rules"] = rules
    await broadcast({"t": "rules", "rules": rules})


async def set_status(state, detail):
    if STATE["status"] == {"state": state, "detail": detail}:
        return
    STATE["status"] = {"state": state, "detail": detail}
    log(f"tiktok: {state} {detail}")
    await broadcast({"t": "status", "state": state, "detail": detail, "user": USER})


# ---------- panel ----------

def catalog_table(gifts):
    rules = STATE["rules"]
    lines = [f"catalog: {len(gifts)} gifts, {len(rules)} mapped"]
    ids = {str(gift["id"]) for gift in gifts}
    for gift in gifts:
        rule = rules.get(str(gift["id"]))
        if not rule:
            continue
        lines.append(
            f"  {gift['id']:>9}  {gift['name'][:28]:<28}  {gift['coins']:>6} coins  "
            f"{rule['effect']} x{rule['count']}"
        )
    stale = sorted(set(rules) - ids)
    if stale:
        lines.append(f"  {len(stale)} mapped id(s) not in this room: {', '.join(stale[:12])}")
    log("\n".join(lines))


class PanelHandler(BaseHTTPRequestHandler):
    server_version = "GiftSnakeBridge"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # one line per request is noise in a stream log
        pass

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _page(self):
        try:
            with open(os.path.join(ROOT, "panel.html"), "rb") as handle:
                body = handle.read()
        except OSError:
            self.send_error(500, "panel.html missing")
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path in ("/", "/index.html", "/panel.html"):
            self._page()
        elif path == "/api/state":
            self._json(200, panel_state())
        elif path == "/api/events":
            since = 0
            for part in query.split("&"):
                if part.startswith("since="):
                    try:
                        since = int(part[6:] or 0)
                    except ValueError:
                        since = 0
            self._json(200, feed_since(since))
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.split("?")[0] != "/api/rules":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 512 * 1024:
            self._json(400, {"ok": False, "error": "expected a JSON body under 512 KB"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            self._json(400, {"ok": False, "error": "body is not valid JSON"})
            return
        raw = payload.get("rules") if isinstance(payload, dict) else None
        if not isinstance(raw, dict):
            self._json(400, {"ok": False, "error": "expected {rules: {giftId: {effect, count}}}"})
            return
        try:
            rules = save_rules(CONFIG_PATH, raw)
        except OSError as exc:
            self._json(500, {"ok": False, "error": f"could not write config: {exc}"})
            return
        # The callback, not this thread, updates state and tells the page. A
        # closed loop (bridge shutting down) must not fail a save that landed.
        try:
            asyncio.run_coroutine_threadsafe(broadcast_rules(rules), LOOP)
        except RuntimeError:
            log("rules: event loop closed, page not told about the new table")
        log(f"rules: saved {len(rules)} mappings to {CONFIG_PATH}")
        self._json(200, {"ok": True, "rules": rules})


def start_panel():
    """The panel port collides with other local apps often enough to walk forward."""
    for port in range(PANEL_PORT, PANEL_PORT + 10):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), PanelHandler)
        except OSError:
            log(f"panel port {port} busy, trying {port + 1}")
            continue
        httpd.daemon_threads = True
        threading.Thread(target=httpd.serve_forever, daemon=True, name="panel").start()
        log(f"panel listening on http://127.0.0.1:{port}")
        return
    log(
        f"panel disabled: ports {PANEL_PORT}-{PANEL_PORT + 9} are busy. "
        "The gift feed keeps running; free a port or set PANEL_PORT."
    )
    return None


# ---------- game feed ----------

async def handle_client(ws):
    CLIENTS.add(ws)
    log(f"client connected ({len(CLIENTS)} total)")
    await send(ws, {"t": "catalog", "gifts": STATE["catalog"]})
    await send(ws, {"t": "rules", "rules": STATE["rules"]})
    await send(ws, {"t": "status", **STATE["status"], "user": USER})
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("t") == "ping":
                await send(ws, {"t": "status", **STATE["status"], "user": USER})
            elif msg.get("t") == "reconnect":
                await switch_room(msg.get("user"))
    except websockets.ConnectionClosed:
        pass
    finally:
        CLIENTS.discard(ws)
        log(f"client disconnected ({len(CLIENTS)} left)")


def clean(value):
    return str(value or "").strip().lstrip("@")


def viewer_of(event):
    """Handle, display name and the fallback the page prints in toasts."""
    user = getattr(event, "user", None)
    unique_id = clean(getattr(user, "unique_id", None)) or clean(
        getattr(user, "display_id", None)
    )
    nickname = (
        clean(getattr(user, "nickname", None))
        or clean(getattr(user, "nick_name", None))
        or unique_id
        or "viewer"
    )
    return {"uniqueId": unique_id or nickname, "nickname": nickname}


def one_line(text, limit=120):
    """Comment text on a single log line; the bridge log is one line per event."""
    return " ".join(str(text or "").split())[:limit]


def effect_label(key):
    rule = STATE["rules"].get(key)
    return f"{rule['effect']} x{rule['count']}" if rule else "no panel mapping"


# Comments, likes, joins, follows and shares all take the same route: log the
# line, then broadcast it. The page decides whether the kind is mapped to an
# effect, exactly as it does for gifts, so nothing fires until the panel says so.
async def publish_interaction(kind, event, text=None, count=None):
    who = viewer_of(event)
    text = one_line(text) if text else None
    msg = {"t": "interaction", "kind": kind, "user": who}
    if text:
        msg["text"] = text
    if count is not None:
        msg["count"] = int(count)
    await broadcast(msg)
    record_event(kind, kind, kind, who, count)
    extra = f' "{text}"' if text else (f" x{count}" if count else "")
    log(f"{kind} @{who['uniqueId']}{extra} -> {effect_label(kind)}")


async def refresh_catalog(web):
    """The gift list is unsigned, so it loads even when the room is offline."""
    try:
        data = await web.fetch_gift_list()
    except Exception as exc:
        log(f"gift catalog fetch failed: {exc}")
        return
    catalog = normalize_catalog(data.get("gifts") or [])
    if not catalog:
        return
    STATE["catalog"] = catalog
    GIFT_NAMES.clear()
    GIFT_NAMES.update({gift["id"]: gift["name"] for gift in catalog})
    await broadcast({"t": "catalog", "gifts": catalog})
    catalog_table(catalog)


def make_client():
    client = TikTokLiveClient(USER)
    if SESSION_ID:
        client.web.set_session(SESSION_ID, TARGET_IDC)
        if not TARGET_IDC:
            log("note: TIKTOK_TARGET_IDC unset, authenticated socket may be rejected")

    @client.on(ConnectEvent)
    async def on_connect(_event):
        await set_status("connecting", "fetching gift catalog")
        await refresh_catalog(client.web)
        await set_status("live", f"@{USER}")

    @client.on(DisconnectEvent)
    async def on_disconnect(_event):
        await set_status("offline", "disconnected")

    @client.on(LiveEndEvent)
    async def on_end(_event):
        await set_status("offline", "stream ended")

    @client.on(GiftEvent)
    async def on_gift(event):
        # Combo increments arrive one per tap and repeat_end marks the last one,
        # so the game hears one message per combo carrying the cumulative count.
        if not event.repeat_end:
            return
        gift = event.gift
        gift_id = int(event.gift_id or 0)
        name = (gift.name if gift else "") or GIFT_NAMES.get(gift_id, "")
        count = max(1, int(event.repeat_count or 1))
        if gift_id <= 0:
            return
        who = viewer_of(event)
        diamond = int(getattr(gift, "diamond_count", 0) or 0) if gift else 0
        await broadcast(
            {
                "t": "gift",
                "giftId": gift_id,
                "name": name,
                "count": count,
                "coins": diamond * count,
                "user": who,
            }
        )
        record_event(gift_id, "gift", name or f"Gift {gift_id}", who, count)
        log(
            f"gift {gift_id} {name} x{count} @{who['uniqueId']} "
            f"({diamond} coins) -> {effect_label(str(gift_id))}"
        )

    @client.on(CommentEvent)
    async def on_comment(event):
        await publish_interaction("comment", event, text=event.comment)

    @client.on(LikeEvent)
    async def on_like(event):
        # TikTok reports likes in batches; split them so each like pays out once.
        for _ in range(max(1, int(event.count or 1))):
            await publish_interaction("like", event, count=1)

    @client.on(JoinEvent)
    async def on_join(event):
        await publish_interaction("join", event)

    @client.on(FollowEvent)
    async def on_follow(event):
        await publish_interaction("follow", event)

    @client.on(ShareEvent)
    async def on_share(event):
        await publish_interaction("share", event)

    return client


def kick_loop():
    """(Re)start the TikTok loop after a give-up or a room change."""
    task = ROOM["task"]
    if task is None or task.done():
        ROOM["task"] = asyncio.create_task(tiktok_loop())


async def rest():
    """Wait between attempts, but wake early when a room switch asks for one."""
    wake = ROOM["wake"]
    if wake is None:
        await asyncio.sleep(RETRY_DELAY)
        return
    try:
        await asyncio.wait_for(wake.wait(), RETRY_DELAY)
    except asyncio.TimeoutError:
        pass
    finally:
        wake.clear()


async def switch_room(raw_user):
    """Point the bridge at another handle; empty input keeps the current room."""
    global USER
    handle = clean(raw_user)
    if handle:
        USER = handle
    ROOM["generation"] += 1
    ROOM["failures"] = 0  # a manual retry gets the full budget again
    log(f"room: reconnect requested for @{USER}")
    client = ROOM["client"]
    if client is not None:
        try:
            await client.disconnect()
        except Exception as exc:
            log(f"room: disconnect failed ({exc})")
    if ROOM["wake"] is not None:
        ROOM["wake"].set()
    await set_status("connecting", f"@{USER}")
    kick_loop()


async def tiktok_loop():
    ROOM["failures"] = 0
    while True:
        generation = ROOM["generation"]
        client = make_client()
        ROOM["client"] = client
        try:
            await set_status("connecting", f"@{USER}")
            await client.connect(process_connect_events=True, fetch_live_check=True)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            ROOM["client"] = None
            if generation != ROOM["generation"]:
                # A room change cancelled this attempt; it was not a failure.
                ROOM["failures"] = 0
                continue
            ROOM["failures"] += 1
            # Errors from the unofficial client can be a paragraph long; the chip
            # only has room for the opening of it.
            detail = (str(exc) or type(exc).__name__)[:160]
            if ROOM["failures"] > MAX_RETRIES:
                # The sign server rate-limits repeated joins, so stop asking; the
                # debug menu can start a fresh round of retries.
                await set_status(
                    "offline", f"gave up after {MAX_RETRIES} reconnects: {detail}"
                )
                log("bridge stopped reconnecting; use the debug menu or restart it")
                return
            await set_status(
                "offline", f"retry {ROOM['failures']}/{MAX_RETRIES}: {detail}"
            )
            await rest()
            continue
        ROOM["client"] = None
        if generation != ROOM["generation"]:
            ROOM["failures"] = 0
            continue
        # A connection that actually joined and then ended starts the budget over.
        ROOM["failures"] = 0
        await set_status("offline", "disconnected")
        await rest()


async def main():
    global LOOP
    LOOP = asyncio.get_running_loop()
    start_panel()
    try:
        server = await serve(handle_client, "127.0.0.1", PORT)
    except OSError as exc:
        sys.exit(f"game socket port {PORT} busy ({exc}). Another bridge running? Set PORT.")
    async with server:
        log(f"bridge listening on ws://127.0.0.1:{PORT}")
        probe = TikTokLiveClient(USER)
        try:
            await refresh_catalog(probe.web)
        finally:
            await probe.web.close()
        ROOM["wake"] = asyncio.Event()
        kick_loop()
        try:
            # The panel and socket outlive a given-up TikTok loop so the room can
            # be retried from the debug menu without restarting the process.
            await asyncio.Event().wait()
        finally:
            task = ROOM["task"]
            if task is not None and not task.done():
                task.cancel()
            log("bridge stopping")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("bridge stopping")
