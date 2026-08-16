from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import build_cv_pack, prepare_samples
from tools.voice_device import resolve_device


def case_clips(langs: tuple[str, ...] = ("nl", "en")) -> list[dict]:
    clips = [
        {"id": "station1", "lang": "nl", "transcript": "test"},
        {"id": "station1-en", "lang": "en", "transcript": "test"},
    ] if langs == ("nl", "en") else []
    for lang in langs:
        for index in range(1, 11):
            label = "real" if index % 2 else "fake"
            clips.append({
                "id": prepare_samples.case_id(lang, index),
                "lang": lang,
                "label": label,
                "difficulty": (index + 1) // 2,
                "durationSec": 4.0,
                "transcript": "delivered transcript",
                "provenance": {"sourceId": f"{lang}-{label}-{index}"},
            })
    return clips


class PipelineContractTests(unittest.TestCase):
    def test_voice_device_prefers_cuda_then_mps_then_cpu(self) -> None:
        self.assertEqual(
            resolve_device("auto", cuda_available=True, mps_available=True), "cuda"
        )
        self.assertEqual(
            resolve_device("auto", cuda_available=False, mps_available=True), "mps"
        )
        self.assertEqual(
            resolve_device("auto", cuda_available=False, mps_available=False), "cpu"
        )

    def test_voice_device_override_must_be_available(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "CUDA is not available"):
            resolve_device("cuda", cuda_available=False, mps_available=False)
        with self.assertRaisesRegex(RuntimeError, "MPS is not available"):
            resolve_device("mps", cuda_available=False, mps_available=False)
        with self.assertRaisesRegex(ValueError, "auto, cuda, mps, or cpu"):
            resolve_device("tpu", cuda_available=False, mps_available=False)

    def test_manifest_accepts_balanced_bilingual_cases(self) -> None:
        prepare_samples.verify_manifest_contract(case_clips(), require_bilingual=True)

    def test_manifest_rejects_one_language_for_release(self) -> None:
        with self.assertRaisesRegex(prepare_samples.PipelineError, "English and Dutch"):
            prepare_samples.verify_manifest_contract(
                case_clips(("nl",)), require_bilingual=True
            )

    def test_manifest_rejects_empty_delivered_transcript(self) -> None:
        clips = case_clips()
        clips[3]["transcript"] = ""
        with self.assertRaisesRegex(prepare_samples.PipelineError, "non-empty"):
            prepare_samples.verify_manifest_contract(clips, require_bilingual=True)

    def test_case_pack_loader_rejects_partial_v2_pack(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            pack = root / "tools/.cache/pack-nl"
            pack.mkdir(parents=True)
            (pack / "pack.json").write_text(json.dumps({
                "lang": "nl", "source": "Common Voice", "license": "CC0",
                "ttsModel": prepare_samples.TTS_MODEL,
                "asrModel": prepare_samples.ASR_MODEL,
                "cases": [{}] * 10,
            }))
            with patch.object(prepare_samples, "ROOT", root):
                with self.assertRaisesRegex(prepare_samples.PipelineError, "bilingual"):
                    prepare_samples.load_case_packs()

    def test_case_pack_loader_requires_pinned_revisions_and_checksums(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            root = Path(name)
            for lang in ("nl", "en"):
                pack = root / f"tools/.cache/pack-{lang}"
                pack.mkdir(parents=True)
                (pack / "pack.json").write_text(json.dumps({
                    "lang": lang, "source": "Common Voice", "license": "CC0",
                    "sourceRevision": prepare_samples.COMMON_VOICE_REVISION,
                    "ttsModel": prepare_samples.TTS_MODEL,
                    "ttsRevision": prepare_samples.TTS_REVISION,
                    "asrModel": prepare_samples.ASR_MODEL,
                    "asrRevision": prepare_samples.ASR_REVISION,
                    "cases": [{"sourceSha256": "not-a-digest"}] * 10,
                }))
            with patch.object(prepare_samples, "ROOT", root):
                with self.assertRaisesRegex(prepare_samples.PipelineError, "SHA-256"):
                    prepare_samples.load_case_packs()

    def test_public_asset_path_rejects_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as name:
            with self.assertRaisesRegex(prepare_samples.PipelineError, "unsafe"):
                prepare_samples.asset_path(Path(name), "/samples/../secret", "test")

    def test_wer_is_zero_only_for_matching_words(self) -> None:
        self.assertEqual(build_cv_pack.wer("Hallo wereld!", "hallo wereld"), 0.0)
        self.assertGreater(build_cv_pack.wer("Hallo wereld", "iets anders"), 0.0)


if __name__ == "__main__":
    unittest.main()
