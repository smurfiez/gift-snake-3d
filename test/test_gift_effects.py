import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

from gift_effects import (  # noqa: E402
    DEFAULT_RULES,
    clean_rules,
    load_rules,
    normalize_catalog,
    save_rules,
)


class CleanRulesTest(unittest.TestCase):
    def test_keeps_valid_entries_and_defaults_the_count(self):
        rules = clean_rules({"6064": {"effect": "bomb"}, "5487": {"effect": "apple", "count": 20}})
        self.assertEqual(rules["6064"], {"effect": "bomb", "count": 1})
        self.assertEqual(rules["5487"], {"effect": "apple", "count": 20})

    def test_accepts_the_shorthand_and_apple_default(self):
        self.assertEqual(clean_rules({"1": "apple"}), {"1": {"effect": "apple", "count": 5}})

    def test_drops_unknown_effects_and_ids(self):
        rules = clean_rules({"1": {"effect": "nope", "count": 2}, "abc": "bomb", "-4": "bomb", 2: "slow"})
        self.assertEqual(rules, {"2": {"effect": "slow", "count": 1}})

    def test_clamps_the_item_count(self):
        self.assertEqual(clean_rules({"1": {"effect": "bomb", "count": 0}})["1"]["count"], 1)
        self.assertEqual(clean_rules({"1": {"effect": "bomb", "count": 5000}})["1"]["count"], 999)
        self.assertEqual(clean_rules({"1": {"effect": "bomb", "count": "x"}})["1"]["count"], 1)

    def test_rejects_a_non_dict(self):
        self.assertEqual(clean_rules(["apple"]), {})
        self.assertEqual(clean_rules(None), {})

    def test_keeps_interaction_keys(self):
        rules = clean_rules({"follow": "apple", "comment": {"effect": "speed", "count": 2}, "bogus": "bomb"})
        self.assertEqual(
            rules,
            {
                "comment": {"effect": "speed", "count": 2},
                "follow": {"effect": "apple", "count": 5},
            },
        )

    def test_sorts_interactions_before_gift_ids(self):
        rules = clean_rules({"6064": "bomb", "share": "apple", "1": "slow"})
        self.assertEqual(list(rules), ["share", "1", "6064"])


class RulesFileTest(unittest.TestCase):
    def test_save_then_load_round_trips(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gift-effects.json"
            saved = save_rules(path, DEFAULT_RULES)
            self.assertEqual(load_rules(path), saved)
            self.assertEqual(sorted(saved), sorted(DEFAULT_RULES))

    def test_a_broken_file_falls_back_to_the_defaults(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "gift-effects.json"
            path.write_text("{not json", encoding="utf-8")
            self.assertEqual(load_rules(path), DEFAULT_RULES)
            self.assertEqual(load_rules(Path(tmp) / "missing.json"), DEFAULT_RULES)


class CatalogTest(unittest.TestCase):
    def test_normalizes_and_drops_nameless_entries(self):
        catalog = normalize_catalog(
            [
                {"id": 5655, "name": "Rose", "diamond_count": 1},
                {"id": 5656, "describe": "GG", "diamondCount": 1},
                {"id": 0, "name": "Ghost"},
                {"id": 1, "name": ""},
                "junk",
            ]
        )
        self.assertEqual(
            catalog,
            [
                {"id": 5655, "name": "Rose", "coins": 1},
                {"id": 5656, "name": "GG", "coins": 1},
            ],
        )

    def test_rejects_a_non_list(self):
        self.assertEqual(normalize_catalog(None), [])


if __name__ == "__main__":
    unittest.main()
