"""client-file-label.py end to end: headless `claude -p` with the built plugins/lawyer reads a
client file, and the tool_result the model saw, as the session transcript records it, holds
the label. The only proof that Claude Code applies updatedToolOutput rather than silently
ignoring it. Run locally after each Claude Code upgrade: CI has no CLI auth, so it skips there.
Build plugins/lawyer first (python scripts/build_plugin.py)."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
PLUGIN = REPO / "plugins" / "lawyer"
LABEL = '<client_file source="client file: letter.txt">'

pytestmark = pytest.mark.skipif(bool(os.environ.get("CI")) or shutil.which("claude") is None,
                                reason="needs a signed-in claude CLI; CI has none")


def tool_results(transcript: Path):
    for line in transcript.read_text(encoding="utf-8").splitlines():
        message = json.loads(line).get("message") or {}
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "tool_result":
                inner = block.get("content")
                if isinstance(inner, str):
                    yield inner
                elif isinstance(inner, list):
                    yield "".join(part.get("text", "") for part in inner if isinstance(part, dict))


def seen(tmp_path: Path, tool: str, prompt) -> list[str]:
    root = tmp_path / "0. CASE DATA"
    matter = root / "L0001 Matter"
    matter.mkdir(parents=True)
    letter = matter / "letter.txt"
    letter.write_text("Dear counsel,\nThe hearing is set.\n", encoding="utf-8")
    config = tmp_path / "probanda.json"
    config.write_text(json.dumps({"case_data_root": str(root), "person": "e2e"}), encoding="utf-8")

    result = subprocess.run(
        ["claude", "-p", prompt(letter, root), "--plugin-dir", str(PLUGIN), "--model", "haiku",
         "--allowedTools", tool, "--output-format", "json"],
        cwd=tmp_path, env={**os.environ, "COCLERK_CONFIG_PATH": str(config)},
        capture_output=True, text=True, encoding="utf-8", timeout=300)
    assert result.returncode == 0, result.stderr
    session_id = json.loads(result.stdout)["session_id"]
    transcripts = list((Path.home() / ".claude" / "projects").glob(f"*/{session_id}.jsonl"))
    assert len(transcripts) == 1, transcripts
    texts = [text for text in tool_results(transcripts[0]) if "The hearing is set." in text]
    assert texts, f"the {tool} result is not in the transcript"
    return texts


def test_the_model_sees_the_label_on_a_read_client_file(tmp_path):
    texts = seen(tmp_path, "Read",
                 lambda letter, root: f"Use the Read tool to read {letter} and then reply with the word done.")
    assert all(LABEL in text and "</client_file>" in text for text in texts), texts


def test_the_model_sees_the_label_on_grep_matches_in_client_files(tmp_path):
    texts = seen(tmp_path, "Grep",
                 lambda letter, root: f"Use the Grep tool once with pattern 'hearing', output_mode content, "
                                      f"path {root}, and then reply with the word done.")
    assert all('<client_file source="client files: grep matches">' in text and "</client_file>" in text
               for text in texts), texts
