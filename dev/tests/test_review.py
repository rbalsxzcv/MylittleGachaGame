"""스토리 검수 구조 잠금 (CHARACTER_PROFILE.md 8-2장): 장면 id · 전투 위치 · next · 선택지 goto가 바뀌면 거부, 대사만 바뀌면 통과"""
import copy
import unittest

from tinydev import review

ORIG = {
    "id": "story_0013",
    "title": "진흙탕",
    "scenes": [
        {"id": "s1", "background": {"type": "color", "value": "#111"}, "next": "b1", "lines": [{"speaker": "char_0001", "text": "셋."}, {"speaker": "narrator", "text": "비.", "choices": [{"text": "간다", "goto": "b1"}, {"text": "숨는다", "goto": "s2"}]}]},
        {"id": "s2", "background": {"type": "color", "value": "#222"}, "next": "b1", "lines": [{"speaker": "narrator", "name": "단장", "text": "퇴직금 정산이다."}]},
        {"id": "b1", "type": "battle", "stageId": "stage_0001", "next": "s3"},
        {"id": "s3", "background": {"type": "color", "value": "#333"}, "lines": [{"speaker": "char_0008", "text": "한 잔 더."}]},
    ],
}


class LockTest(unittest.TestCase):
    def test_line_changes_pass(self):
        rev = copy.deepcopy(ORIG)
        rev["scenes"][0]["lines"][0]["text"] = "셋. 오른쪽."
        rev["scenes"][1]["lines"].append({"speaker": "narrator", "text": "추가된 줄"})
        rev["scenes"][3]["lines"] = [{"speaker": "char_0001", "text": "화자 바뀜"}]
        rev["scenes"][0]["lines"][1]["choices"][0]["text"] = "문구는 다듬어도 됨"
        self.assertEqual(review.locked_changes(ORIG, rev), [])

    def test_locked_changes_rejected(self):
        cases = {
            "장면 id": lambda r: r["scenes"][0].update(id="s9"),
            "순서": lambda r: r["scenes"].reverse(),
            "전투": lambda r: r["scenes"][2].update(stageId="stage_0002"),
            "next": lambda r: r["scenes"][1].update(next="s3"),
            "goto": lambda r: r["scenes"][0]["lines"][1]["choices"][1].update(goto="s3"),
            "선택지 개수": lambda r: r["scenes"][0]["lines"][1]["choices"].pop(),
            "전투 위치": lambda r: r["scenes"].insert(0, r["scenes"].pop(2)),
        }
        for label, change in cases.items():
            rev = copy.deepcopy(ORIG)
            change(rev)
            self.assertTrue(review.locked_changes(ORIG, rev), label)


class MergeTest(unittest.TestCase):
    def test_merge_keeps_frame_from_original(self):
        revised = [
            {"id": "s1", "background": {"type": "color", "value": "#fff"}, "lines": [{"speaker": "char_0001", "text": "셋, 오른쪽."}, {"speaker": "narrator", "text": "비가 그친다.", "choices": [{"text": "간다", "goto": "b1"}, {"text": "숨는다", "goto": "s2"}]}]},
            {"id": "s2", "lines": [{"speaker": "char_0001", "text": "선택지를 없앰", "choices": []}, {"speaker": "ghost_npc", "text": "모르는 화자"}]},
            {"id": "b1", "type": "battle", "stageId": "stage_9999"},
            {"id": "s9", "lines": [{"speaker": "narrator", "text": "새 장면"}]},
        ]
        scenes, warnings = review.merge_revised(ORIG, revised, {"char_0001", "char_0008"})
        self.assertEqual([s["id"] for s in scenes], ["s1", "s2", "b1", "s3"])
        self.assertEqual(scenes[0]["background"], ORIG["scenes"][0]["background"])  # 배경은 원본
        self.assertEqual(scenes[0]["lines"][0]["text"], "셋, 오른쪽.")
        self.assertEqual(scenes[1]["lines"][1], {"speaker": "narrator", "text": "모르는 화자", "name": "ghost_npc"})
        self.assertEqual(scenes[2], ORIG["scenes"][2])  # 전투는 원본 그대로
        self.assertEqual(scenes[3], ORIG["scenes"][3])  # 검수본에 없는 장면 = 원본
        self.assertTrue(any("s3" in w for w in warnings))
        self.assertTrue(any("s9" in w for w in warnings))
        self.assertEqual(review.locked_changes(ORIG, {"scenes": scenes}), [])

    def test_choice_change_keeps_original_scene(self):
        revised = [{"id": "s1", "lines": [{"speaker": "narrator", "text": "선택지 없이"}]}]
        scenes, warnings = review.merge_revised(ORIG, revised, set())
        self.assertEqual(scenes[0], ORIG["scenes"][0])
        self.assertTrue(any("선택지" in w for w in warnings))

    def test_count_rules(self):
        self.assertEqual(review.count_rules([{"rule": 1}, {"rule": 1}, {"rule": 4}, {"rule": 0}]), {"1": 2, "4": 1, "0": 1})


if __name__ == "__main__":
    unittest.main()
