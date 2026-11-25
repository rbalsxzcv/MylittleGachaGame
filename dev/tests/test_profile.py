"""프로필 정리 · 검사 · 배포 정리 (dev/tinydev/profile.py, validate.py)

실행: dev/.venv/Scripts/python -m unittest discover -s dev/tests -t dev
"""
import unittest

from tinydev import profile, validate

GOOD = {
    "facts": {"age": "스물하나", "likes": ["따뜻한 우유", "높은 곳"]},
    "stories": [{"title": "첫 번째 도망", "text": "장면", "unlock": {"breakthrough": 1}}],
    "lines": {"obtain": "……시논. 척후.", "idle": ["우유 남았어?"]},
    "relations": [{"id": "char_0008", "label": "그 마녀", "note": "인정"}],
    "voice": {
        "personality": "말수 적은 현실주의자",
        "speech": "반말. 짧은 평서문",
        "address": {"protagonist": "단장", "char_0008": "그 마녀"},
        "never": ["욕설"],
        "weakness": "도망친 과거",
        "samples": ["셋.", "우유.", "……늦었을 뿐이야."],
    },
}
IDS = {"char_0001", "char_0008"}


class ProfileCleanTest(unittest.TestCase):
    def test_good_profile_has_no_issues(self):
        self.assertEqual(profile.issues(GOOD, IDS), [])
        self.assertEqual(profile.voice_warnings(GOOD["voice"]), [])

    def test_issues_match_game_rules(self):
        bad = {
            "facts": {"age": "가" * 41},
            "stories": [{"text": "x", "unlock": {"breakthrough": 0}}] * 4,
            "lines": {"idle": ["a"] * 6},
            "relations": [{"id": "ghost"}],
            "voice": {"samples": ["하나"], "address": {"ghost": "유령", "protagonist": "단장"}},
        }
        text = "\n".join(profile.issues(bad, IDS))
        for part in ("facts.age", "stories: 4편", "unlock.breakthrough", "lines.idle", "relations[0].id", "voice.samples", "없는 캐릭터 (ghost)"):
            self.assertIn(part, text)
        self.assertNotIn("(protagonist)", text)

    def test_clean_profile_lists_from_lines_and_npc_voice_only(self):
        p = profile.clean_profile({"facts": {"likes": "우유\n\n높은 곳"}, "voice": {"never": "욕설\n설명", "personality": "  조용함 "}})
        self.assertEqual(p["facts"]["likes"], ["우유", "높은 곳"])
        self.assertEqual(p["voice"], {"personality": "조용함", "never": ["욕설", "설명"]})
        npc = profile.clean_profile(GOOD, npc=True)
        self.assertEqual(set(npc), {"voice", "version"})

    def test_voice_warnings(self):
        self.assertEqual(len(profile.voice_warnings({"personality": "x"})), 2)

    def test_strip_voice_for_publish(self):
        c = {"id": "char_0001", "profile": GOOD}
        out = profile.strip_voice(c)
        self.assertNotIn("voice", out["profile"])
        self.assertIn("voice", c["profile"])  # 원본은 그대로
        self.assertIs(profile.strip_voice({"id": "x"})["id"], "x")


class ValidateProfileTest(unittest.TestCase):
    def _items(self, chars):
        r = validate.Report()
        ids = {c["id"] for c in chars}
        for c in chars:
            validate._check_profile(r, f"characters/{c['id']}", c, ids, c.get("rarity") == "npc")
        return r.items

    def test_errors_and_warnings(self):
        items = self._items([
            {"id": "char_0001", "rarity": 4, "profile": {**GOOD, "relations": [{"id": "char_0404"}]}},
            {"id": "char_0008", "rarity": 5},
            {"id": "char_0013", "rarity": "npc", "profile": {"voice": {"personality": "늙은 영주"}}},
        ])
        errors = [i for i in items if i["level"] == "error"]
        warns = [i["where"] + " " + i["message"] for i in items if i["level"] == "warning"]
        self.assertEqual(len(errors), 1)
        self.assertIn("char_0404", errors[0]["message"])
        self.assertTrue(any("char_0008" in w and "프로필이 없어요" in w for w in warns))
        self.assertTrue(any("char_0013" in w and "weakness" in w for w in warns))


if __name__ == "__main__":
    unittest.main()
