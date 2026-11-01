"""Temporary Cowork spike test P1, removed after the run.

As a hook it never adds text to the session: it always prints {}. A prompt the user types starting
te-p1 makes it check each place a file might outlast the session. It counts the markers earlier
sessions left there, adds one of its own, tries a bare web request to each fixed address, and
writes <root>/p1/report.json, where <root> is TOKENECONOMIZER_HOME or ~/.tokeneconomizer. The report
holds environment variable names, never values."""
import glob
import json
import os
import sys
import time
import urllib.error
import urllib.request

MARKER_DIR = ".te-p1"
MAX_PROJECTS = 3
WEB_TIMEOUT = 5
WEB_TARGETS = ["https://github.com", "https://example.com", "https://pypi.org", "https://nbzkuhgiqscjkypedqff.supabase.co"]


def stores():
    found = {f"projects:{os.path.basename(p.rstrip('/'))}": p for p in sorted(glob.glob("/projects/*/"))[:MAX_PROJECTS]}
    for name in ("CLAUDE_PLUGIN_DATA", "CLAUDE_PLUGIN_ROOT"):
        if os.environ.get(name):
            found[name] = os.environ[name]
    return found


def check_store(path, session):
    folder = os.path.join(path, MARKER_DIR)
    result = {"path": path, "earlier_markers": 0}
    try:
        result["earlier_markers"] = sum(1 for name in os.listdir(folder) if name != f"{session}.txt")
    except OSError:
        pass
    try:
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, f"{session}.txt"), "w", encoding="utf-8") as f:
            f.write(f"{time.time()}\n")
        result["write"] = "ok"
    except OSError as err:
        result["write"] = type(err).__name__
    return result


def check_web(url):
    request = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(request, timeout=WEB_TIMEOUT) as response:
            return response.status
    except urllib.error.HTTPError as err:
        return err.code
    except Exception as err:
        return type(err).__name__


def mounts():
    try:
        with open("/proc/self/mounts", encoding="utf-8") as f:
            return [" ".join(line.split()[1:3]) for line in f]
    except OSError:
        return []


def run(session):
    report = {
        "at": time.time(),
        "session_id": session,
        "stores": {name: check_store(path, session) for name, path in stores().items()},
        "web": {url: check_web(url) for url in WEB_TARGETS},
        "env_names": sorted(os.environ),
        "mounts": mounts(),
    }
    root = os.environ.get("TOKENECONOMIZER_HOME") or os.path.expanduser("~/.tokeneconomizer")
    folder = os.path.join(root, "p1")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)


def main():
    p = json.load(sys.stdin)
    if (p.get("prompt") or "").lstrip().startswith("te-p1"):
        run(str(p.get("session_id") or "unknown"))
    print("{}")


if __name__ == "__main__":
    main()
