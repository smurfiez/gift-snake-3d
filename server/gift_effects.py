"""Gift id -> board effect config, shared by the bridge, the panel and the tests.

The bridge broadcasts the whole table to the page, which applies it ahead of its
baked-in GIFT_RULES, so saving in the panel changes the game without a reload.
"""

import json
import os
from pathlib import Path

# Effect names are the same keys the game uses for keyboard gifts.
EFFECTS = ("apple", "bomb", "speed", "slow", "widen", "taller")

# Non-gift interactions the bridge can forward. They live in the same table as
# gift ids, keyed by name instead of number, so one panel maps both.
INTERACTIONS = ("comment", "like", "join", "follow", "share")

# A gift with no explicit item count spawns this many; other effects apply once.
DEFAULT_COUNT = {"apple": 5}

# Matches src/tiktok.js GIFT_RULES, so a fresh install behaves like the shipped
# game until the streamer edits the table in the panel.
DEFAULT_RULES = {
    "6064": {"effect": "bomb", "count": 5},
    "5487": {"effect": "apple", "count": 20},
    "8913": {"effect": "bomb", "count": 20},
    "5879": {"effect": "bomb", "count": 50},
    "5659": {"effect": "taller", "count": 1},
    "10802": {"effect": "widen", "count": 1},
}

MAX_COUNT = 999


def _count(effect, value):
    try:
        n = int(value)
    except (TypeError, ValueError):
        n = DEFAULT_COUNT.get(effect, 1)
    return max(1, min(MAX_COUNT, n))


def _key(value):
    """Gift ids stay strings of digits; interaction kinds pass through as named."""
    name = str(value)
    if name in INTERACTIONS:
        return name
    try:
        gift_id = int(name)
    except (TypeError, ValueError):
        return None
    return str(gift_id) if gift_id > 0 else None


def _order(key):
    if key in INTERACTIONS:
        return (0, INTERACTIONS.index(key), "")
    return (1, 0, int(key))


def clean_rules(raw):
    """Keep only valid entries, so a hand-edited JSON file cannot poison the feed.

    Accepts ``{"6064": {"effect": "bomb", "count": 5}}``, the shorthand
    ``{"6064": "bomb"}``, and interaction keys such as ``{"follow": "apple"}``.
    """
    rules = {}
    if not isinstance(raw, dict):
        return rules
    for key, value in raw.items():
        gift_id = _key(key)
        if gift_id is None:
            continue
        if isinstance(value, str):
            effect, count = value, None
        elif isinstance(value, dict):
            effect, count = value.get("effect"), value.get("count")
        else:
            continue
        if effect not in EFFECTS:
            continue
        rules[gift_id] = {"effect": effect, "count": _count(effect, count)}
    return {key: rules[key] for key in sorted(rules, key=_order)}


def load_rules(path):
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return dict(DEFAULT_RULES)
    rules = clean_rules(raw)
    return rules or dict(DEFAULT_RULES)


def save_rules(path, raw):
    """Write the cleaned table atomically; returns what was written."""
    rules = clean_rules(raw)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text(json.dumps(rules, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, target)
    return rules


def normalize_catalog(raw_gifts):
    """TikTok's gift list -> ``[{id, name, coins}]``, dropping nameless entries."""
    gifts = []
    if not isinstance(raw_gifts, list):
        return gifts
    for gift in raw_gifts:
        if not isinstance(gift, dict):
            continue
        try:
            gift_id = int(gift.get("id") or gift.get("giftId") or 0)
        except (TypeError, ValueError):
            continue
        name = str(gift.get("name") or gift.get("describe") or "").strip()
        if gift_id <= 0 or not name:
            continue
        try:
            coins = int(gift.get("diamond_count") or gift.get("diamondCount") or 0)
        except (TypeError, ValueError):
            coins = 0
        gifts.append({"id": gift_id, "name": name, "coins": max(0, coins)})
    return gifts
