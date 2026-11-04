import json
import os
import subprocess
import sys
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "hooks" / "inject-practice-quirks.py"


def test_absent_config_branch_asks_no_tool_call(tmp_path):
    env = {**os.environ, "COCLERK_CONFIG_PATH": str(tmp_path / "absent" / "probanda.json")}
    result = subprocess.run([sys.executable, str(HOOK)], env=env, capture_output=True, timeout=30)
    assert result.returncode == 0
    text = json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"]
    assert "__" not in text and "/lawyer:" not in text
