"""5★ 전용 추억 빈 칸 · 빈 칸 검사 · 추억 배너 그림 입력 (memslots.py, validate.py, batch.banner_input)

실행: dev/.venv/Scripts/python -m unittest discover -s dev/tests -t dev
"""
import unittest
from unittest import mock

from tinydev import batch, memslots, store, validate

CHARS = [
    {"id": "char_0101", "name": "가", "rarity": 5, "addedAt": "2026-12-01T00:00:00+09:00"},
    {"id": "char_0102", "name": "나", "rarity": 4},
    {"id": "char_0103", "name": "다", "rarity": "npc"},
    {"id": "char_0104", "name": "라", "rarity": 5, "retired": True},
    {"id": "char_0105", "name": "마", "rarity": 5},
]


class FakeStore:
    """store.read_list / write_list / next_id 대신 (파일 안 씀)"""

    def __init__(self, chars, mems, banners=()):
        self.lists = {"characters": [dict(c) for c in chars], "memories": [dict(m) for m in mems], "banners": [dict(b) for b in banners]}
        self.n = 500

    def read_list(self, key):
        return [dict(x) for x in self.lists[key]]

    def write_list(self, key, items):
        self.lists[key] = [dict(x) for x in items]

    def next_id(self, kind):
        self.n += 1
        return f"{kind}_{self.n:04d}"

    def patch(self):
        return mock.patch.multiple(store, read_list=self.read_list, write_list=self.write_list, next_id=self.next_id)


class SignatureSlotTest(unittest.TestCase):
    def test_only_5star_playable_without_signature(self):
        fake = FakeStore(CHARS, [{"id": "memory_0001", "kind": "signature", "signatureOf": "char_0105"}])
        with fake.patch():
            made = memslots.ensure_signature_slots()
        self.assertEqual([m["signatureOf"] for m in made], ["char_0101"])  # 4★ · NPC · 은퇴 · 이미 있음 제외
        m = made[0]
        self.assertEqual(m["genKey"], "signature:char_0101")
        self.assertEqual((m["kind"], m["rarity"], m["draft"]), ("signature", 5, True))
        self.assertEqual(m["addedAt"], "2026-12-01T00:00:00+09:00")  # 캐릭터 공개 시각과 같이
        self.assertIn(m["id"], {x["id"] for x in fake.lists["memories"]})

    def test_idempotent_and_filter(self):
        fake = FakeStore(CHARS, [])
        with fake.patch():
            self.assertEqual(memslots.ensure_signature_slots(["char_0102"]), [])  # 4★
            first = memslots.ensure_signature_slots(["char_0101"])
            again = memslots.ensure_signature_slots()
        self.assertEqual(len(first), 1)
        self.assertEqual([m["signatureOf"] for m in again], ["char_0105"])
        self.assertEqual(len(fake.lists["memories"]), 2)

    def test_missing(self):
        self.assertEqual(memslots.missing(CHARS, []), ["char_0101", "char_0105"])


class DraftValidateTest(unittest.TestCase):
    def test_draft_is_warning_only(self):
        slot = memslots.slot_for(CHARS[0], "memory_0007")
        r = validate.Report()
        validate._check_memories(r, {"memories": [slot]}, CHARS[:1], set(), lambda p: True, None)
        mine = [i for i in r.items if i["where"] == "memories/memory_0007"]
        self.assertEqual([i["level"] for i in mine], ["warning"])
        # 빈 칸도 전용 추억 자리로 셈 → '5★인데 전용 추억이 없어요'는 안 나옴
        self.assertFalse([i for i in r.items if i["where"] == "characters/char_0101"])

    def test_held_slot_owner_message(self):
        r = validate.Report()
        validate._check_memories(r, {"memories": [{"id": "memory_0001", "name": "x", "rarity": 3, "kind": "generic", "secondary": {"stat": "atk"}, "passive": {"generic": {"name": "g"}}}]}, CHARS[:1], set(), lambda p: True, None, {"memoryOwners": {"char_0101"}})
        msgs = [i["message"] for i in r.items if i["where"] == "characters/char_0101"]
        self.assertTrue(msgs and "빈 칸" in msgs[0])


class BannerInputTest(unittest.TestCase):
    MEMS = [
        {"id": "memory_0001", "name": "칼날", "rarity": 5, "signatureOf": "char_0101", "theme": ["blade"]},
        {"id": "memory_0002", "name": "빈 칸", "rarity": 5, "signatureOf": "char_0105", "draft": True},
        {"id": "memory_0003", "name": "술집", "rarity": 3, "featuredCharacterId": "char_0102", "theme": ["tavern"]},
    ]

    def test_character_banner_keeps_char_pickups(self):
        out = batch.banner_input({"id": "banner_0001", "pickupIds": ["char_0101", "memory_0001"]}, "x", banners=[], memories=self.MEMS)
        self.assertEqual(out["pickupIds"], ["char_0101"])
        self.assertNotIn("memories", out)

    def test_memory_banner_direct_pickups(self):
        out = batch.banner_input({"id": "banner_0002", "category": "memory", "pickupIds": ["memory_0001", "memory_0003", "memory_0002"]}, banners=[], memories=self.MEMS)
        self.assertEqual(out["pickupIds"], ["char_0101", "char_0102"])  # 빈 칸은 빠짐
        self.assertEqual([m["name"] for m in out["memories"]], ["칼날", "술집"])
        self.assertEqual(out["category"], "memory")

    def test_memory_banner_pickup_from(self):
        banners = [{"id": "banner_0001", "pickupIds": ["char_0101", "char_0105"]}]
        out = batch.banner_input({"id": "banner_0002", "category": "memory", "pickupFrom": "banner_0001"}, banners=banners, memories=self.MEMS)
        self.assertEqual(out["pickupIds"], ["char_0101"])
        self.assertEqual([m["name"] for m in out["memories"]], ["칼날"])


if __name__ == "__main__":
    unittest.main()
