"""프롬프트 내용: profile_draft(다른 캐릭터 말투 요약 + 주인공 카드), chapter_draft(이번 장 등장 캐릭터만 카드 전체)"""
import unittest

from tinydev import prompts

SINON = {"personality": "말수 적은 현실주의자", "speech": "반말. 짧은 평서문", "never": ["욕설"], "weakness": "도망친 과거", "samples": ["셋.", "우유.", "……"], "address": {"protagonist": "단장", "char_0008": "그 마녀"}}
IRENA = {"personality": "술 좋아하는 마녀", "speech": "늘어지는 반말, 가끔 욕", "weakness": "마법의 대가", "never": ["존댓말"], "samples": ["한 잔 더.", "어머.", "……쳇."]}
PROT = {"name": "단장", "voice": {"personality": "능글맞은 용병단장", "speech": "반말, 비꼼", "never": ["정의를 입에 올리기"], "weakness": "죽은 단원들", "samples": ["돈 얘기부터 하지.", "……", "가자."]}}


class ProfilePromptTest(unittest.TestCase):
    def ctx(self, **kw):
        base = {
            "target": {"id": "char_0003", "name": "가린", "rarity": 3, "title": "창병", "kind": "char"},
            "world": "쇠락한 대륙",
            "style": "원칙 1: 현대 직장 비유 금지",
            "others": [{"id": "char_0001", "name": "시논", "voice": SINON}, {"id": "char_0008", "name": "이레나", "voice": IRENA}, {"id": "char_0009", "name": "카드 없음", "voice": {}}],
            "protagonist": PROT,
            "roster": [{"id": "char_0001", "name": "시논"}, {"id": "char_0008", "name": "이레나"}],
            "excerpt": "[1장]\n가린: 창 들어.",
            "part": "all",
        }
        base.update(kw)
        return base

    def test_includes_other_voices_and_protagonist(self):
        text = prompts.profile_draft(self.ctx())
        self.assertIn("- 시논: 성격 말수 적은 현실주의자 / 말투 반말. 짧은 평서문", text)
        self.assertIn("- 이레나: 성격 술 좋아하는 마녀", text)
        self.assertNotIn("카드 없음", text)  # 말투 카드가 없는 캐릭터는 요약에 안 넣음
        self.assertIn("[주인공 말투 카드]", text)
        self.assertIn("능글맞은 용병단장", text)
        self.assertIn("weakness", text)
        self.assertIn("never", text)
        self.assertIn("이레나", text.split("지금 욕설을 쓰는 캐릭터:")[1].split("\n")[0])  # 욕설 쓰는 캐릭터 집계
        self.assertIn("사건과 관계의 사실만", text)

    def test_part_and_voice_only(self):
        self.assertIn('{"lines": …}', prompts.profile_draft(self.ctx(part="lines")))
        npc = prompts.profile_draft(self.ctx(target={"id": "char_0013", "name": "영주", "kind": "npc"}))
        self.assertIn('{"voice":', npc)
        self.assertNotIn('"stories"', npc)
        prot = prompts.profile_draft(self.ctx(target={"id": "protagonist", "name": "단장", "kind": "protagonist"}, protagonist={}))
        self.assertNotIn("[주인공 말투 카드]", prot)

    def test_mock_profile_shape(self):
        import json

        full = json.loads(prompts.mock_profile(self.ctx()))
        self.assertEqual(set(full), {"facts", "stories", "lines", "relations", "voice"})
        self.assertEqual(set(json.loads(prompts.mock_profile(self.ctx(part="stories")))), {"stories"})

    def test_voice_card_format(self):
        card = prompts.voice_card("- id: char_0001 / 시논 / 척후", SINON, {"char_0008": "이레나"}, [{"id": "char_0008", "label": "그 마녀", "note": "마법 실력은 인정"}])
        self.assertIn('호칭: 단장 → "단장", 이레나 → "그 마녀"', card)
        self.assertIn("절대 안 하는 말: 욕설", card)
        self.assertIn("약점: 도망친 과거", card)
        self.assertIn('예시: "셋." / "우유." / "……"', card)
        self.assertIn("관계: 이레나(그 마녀) — 마법 실력은 인정", card)



class ChapterVoiceTest(unittest.TestCase):
    CHARS = [
        {"id": "char_0001", "name": "시논", "title": "척후", "description": "도망친 암살자", "profile": {"voice": SINON, "relations": [{"id": "char_0008", "label": "그 마녀", "note": "실력은 인정"}, {"id": "char_0003", "label": "창잡이", "note": "안 나옴"}]}},
        {"id": "char_0008", "name": "이레나", "title": "마녀", "description": "술꾼 마녀", "profile": {"voice": IRENA}},
        {"id": "char_0003", "name": "가린", "title": "창병", "description": "과묵한 창병", "profile": {"voice": {"personality": "PERSONALITY_GARIN", "speech": "x"}}},
        {"id": "char_0007", "name": "루미 아이올락", "title": "점술가", "description": "카드 없음"},
    ]

    def ctx(self, featured):
        return {
            "meta": {"kind": "main", "chapter": 2, "title": "t"},
            "outline": "o",
            "world": "w",
            "style": "s",
            "prev": [],
            "prev_script": "",
            "chars": self.CHARS,
            "featured": featured,
            "protagonist": PROT,
            "length": "auto",
        }

    def test_only_featured_get_full_cards(self):
        text = prompts.chapter_draft(self.ctx(["char_0001", "char_0008"]))
        self.assertIn("말투 카드를 최우선으로 따를 것", text)
        self.assertIn('- 주인공 (speaker: "narrator", name: "단장")', text)
        self.assertIn("능글맞은 용병단장", text)
        self.assertIn("- id: char_0001 / 시논 / 척후\n  성격: 말수 적은 현실주의자", text)
        self.assertIn("술 좋아하는 마녀", text)
        self.assertNotIn("PERSONALITY_GARIN", text)  # 안 나오는 캐릭터는 한 줄 요약만
        self.assertIn("- id: char_0003 / 이름: 가린 / 칭호: 창병 / 소개: 과묵한 창병", text)
        self.assertIn("관계: 이레나(그 마녀) — 실력은 인정", text)
        self.assertNotIn("창잡이", text)  # 이번 장에 없는 상대와의 관계는 빠짐

    def test_featured_detection(self):
        from tinydev import profile

        prev = {"scenes": [{"lines": [{"speaker": "char_0003", "text": "…"}, {"speaker": "narrator", "name": "이레나", "text": "한 잔"}]}]}
        self.assertEqual(profile.featured_ids(self.CHARS, "루미가 점을 친다", prev, ["char_0001"]), ["char_0001", "char_0008", "char_0003", "char_0007"])
        self.assertEqual(profile.featured_ids(self.CHARS, "아무도 없음"), [])

    def test_no_voice_falls_back_to_description(self):
        text = prompts.chapter_draft(self.ctx(["char_0007"]))
        self.assertIn("- id: char_0007 / 루미 아이올락 / 점술가\n  소개: 카드 없음 (말투 카드 없음)", text)


if __name__ == "__main__":
    unittest.main()
