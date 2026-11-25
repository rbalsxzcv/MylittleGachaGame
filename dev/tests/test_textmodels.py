"""글 생성 모델 고르기 (CHARACTER_PROFILE.md 5-1장): 작업별 기본값, 지정 모델 우선, 설정 없을 때 TG_TEXT_MODEL, 목록에 없는 id 거부"""
import unittest
from unittest import mock

from tinydev import config, genai, settings

MODELS = [
    {"id": "flash", "label": "Flash", "provider": "gemini", "model": "gemini-3.8-flash"},
    {"id": "pro", "label": "Pro", "provider": "gemini", "model": "gemini-3.8-pro"},
]


def make(models=MODELS, model_for=None):
    s = settings.clean(settings._merge(settings.DEFAULTS, {"textModels": models, "textModelFor": model_for or {}}))
    return s


class ResolveTest(unittest.TestCase):
    def test_task_default(self):
        s = make(model_for={"story": "pro", "recap": "flash"})
        self.assertEqual(genai.resolve_text_model("story", s=s)["model"], "gemini-3.8-pro")
        self.assertEqual(genai.resolve_text_model("recap", s=s)["id"], "flash")

    def test_override_wins(self):
        s = make(model_for={"story": "pro"})
        self.assertEqual(genai.resolve_text_model("story", "flash", s=s)["id"], "flash")
        self.assertEqual(genai.resolve_text_model("story", "env", s=s)["model"], config.TEXT_MODEL)

    def test_fallback_to_env_model(self):
        for s in (make(models=[]), make(model_for={})):
            entry = genai.resolve_text_model("story", s=s)
            self.assertEqual(entry["id"], "env")
            self.assertEqual(entry["model"], config.TEXT_MODEL)
        self.assertEqual(genai.resolve_text_model(None, s=make())["id"], "env")

    def test_unknown_id_rejected(self):
        with self.assertRaises(ValueError):
            genai.resolve_text_model("story", "nope", s=make())

    def test_generate_rejects_unknown_even_in_mock(self):
        with mock.patch.object(settings, "load", return_value=make()), mock.patch.object(genai, "is_mock", return_value=True):
            text, entry = genai.generate_text_ex("p", mock=lambda: "모의", task="story", model="pro")
            self.assertEqual((text, entry["id"], entry.get("mock")), ("모의", "pro", True))
            with self.assertRaises(ValueError):
                genai.generate_text("p", mock="x", model="ghost")


class CleanTest(unittest.TestCase):
    def test_clean_models(self):
        models, model_for = settings.clean_text_models(
            [
                {"id": "Flash", "model": "a"},
                {"id": "flash", "model": "dup"},
                {"id": "env", "model": "reserved"},
                {"id": "bad id", "model": "x"},
                {"id": "nomodel", "model": ""},
                {"id": "other", "provider": "openai", "model": "b"},
            ],
            {"story": "flash", "review": "ghost"},
        )
        self.assertEqual([m["id"] for m in models], ["flash", "other"])
        self.assertEqual(models[1]["provider"], "gemini")  # 구현 안 된 제공자는 기본으로
        self.assertEqual(model_for["story"], "flash")
        self.assertEqual(model_for["review"], "")
        self.assertEqual(set(model_for), {k for k, _ in settings.TEXT_TASKS})


if __name__ == "__main__":
    unittest.main()
