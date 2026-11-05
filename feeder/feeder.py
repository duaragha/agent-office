#!/usr/bin/env python3
"""Feed a machine's coding agents into the agent office hub.

Reads Claude Code transcripts (~/.claude/projects) and Codex rollouts
(~/.codex/sessions) read-only, turns each recently active session into an
agent snapshot, and posts it to the hub every few seconds. Answers the hub's
"peek" jobs with a short first-person summary from `claude -p`, so asking an
agent what it is doing never touches its own session.

Standard library only. Compressed Codex rollouts (.jsonl.zst) are read when
the optional `zstandard` package is installed.

    OFFICE_HUB_URL=http://127.0.0.1:8825/office OFFICE_TOKEN=... python3 feeder.py
    python3 feeder.py --demo     # simulated agents, no transcripts read
"""

from __future__ import annotations

import io
import json
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HOME = Path.home()
ENV_FILE = Path(os.environ.get("OFFICE_ENV_FILE", HOME / ".config" / "agent-office" / "feeder.env"))
CLAUDE_PROJECTS = HOME / ".claude" / "projects"
CODEX_SESSIONS = HOME / ".codex" / "sessions"
WORK_DIR = HOME / ".cache" / "agent-office"

PUSH_SECONDS = 3.0
HEARTBEAT_SECONDS = 20.0
RECENT_SECONDS = 20 * 60
WORKING_SECONDS = 90
TAIL_BYTES = 192 * 1024
MAX_AGENTS = 48


def load_env() -> None:
    try:
        lines = ENV_FILE.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def log(message: str) -> None:
    print(f"[office-feeder] {message}", flush=True)


def clip(text: object, limit: int) -> str:
    value = re.sub(r"\s+", " ", str(text or "")).strip()
    return value if len(value) <= limit else value[: limit - 1].rstrip() + "…"


def http_json(url: str, *, body: object = None, token: str = "", timeout: float = 5.0):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(url, data=data, method="POST" if data is not None else "GET")
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    return json.loads(raw.decode("utf-8")) if raw else {}


# --- reading transcripts ---------------------------------------------------


def is_compressed(path: Path) -> bool:
    return path.name.endswith(".zst")


def read_bytes(path: Path, tail: int | None = TAIL_BYTES) -> bytes:
    if is_compressed(path):
        try:
            import zstandard  # optional
        except ImportError:
            return b""
        with path.open("rb") as handle:
            data = zstandard.ZstdDecompressor().stream_reader(handle).read()
        return data[-tail:] if tail else data
    with path.open("rb") as handle:
        size = handle.seek(0, os.SEEK_END)
        start = max(0, size - tail) if tail else 0
        handle.seek(start)
        data = handle.read()
    if start:
        data = data.split(b"\n", 1)[-1]
    return data


def records(path: Path, tail: int | None = TAIL_BYTES) -> list[dict]:
    try:
        data = read_bytes(path, tail)
    except OSError:
        return []
    out = []
    for line in data.decode("utf-8", errors="replace").splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if isinstance(record, dict):
            out.append(record)
    return out


def short_path(value: str) -> str:
    parts = [p for p in str(value).split("/") if p]
    return "/".join(parts[-2:]) if parts else str(value)


def describe_claude_tool(name: str, data: dict) -> tuple[str, str | None]:
    data = data if isinstance(data, dict) else {}
    if name == "Bash":
        return f"$ {clip(data.get('command'), 90)}", None
    if name in {"Edit", "Write", "MultiEdit", "NotebookEdit"}:
        path = data.get("file_path") or data.get("notebook_path") or ""
        return f"{'writing' if name == 'Write' else 'editing'} {short_path(path)}", path or None
    if name == "Read":
        return f"reading {short_path(data.get('file_path') or '')}", None
    if name in {"Grep", "Glob"}:
        return f"searching {clip(data.get('pattern'), 60)}", None
    if name in {"WebSearch", "WebFetch"}:
        return f"web: {clip(data.get('query') or data.get('url'), 70)}", None
    if name in {"Agent", "Task"}:
        return f"delegating: {clip(data.get('description') or data.get('prompt'), 60)}", None
    if name.startswith("mcp__"):
        return f"tool: {name.split('__')[-1]}", None
    return name, None


_EXEC_CMD = re.compile(r'exec_command\(\{\s*cmd:\s*"((?:[^"\\]|\\.)*)"')
_PATCHED = re.compile(r"\*\*\* (?:Update|Add) File: (\S+)")


def describe_codex_tool(name: str, raw) -> tuple[str, list[str]]:
    text = raw if isinstance(raw, str) else json.dumps(raw)
    touched = _PATCHED.findall(text)
    if touched:
        return f"editing {', '.join(short_path(t) for t in touched[:2])}", touched
    if name in {"shell", "exec_command", "local_shell_call", "shell_command"}:
        try:
            args = json.loads(text)
        except ValueError:
            args = {}
        command = (args.get("command") or args.get("cmd")) if isinstance(args, dict) else text
        if isinstance(command, list):
            command = " ".join(str(part) for part in command)
        return f"$ {clip(command or text, 90)}", []
    if name == "exec":
        commands = _EXEC_CMD.findall(text)
        return (f"$ {clip(commands[-1], 90)}" if commands else f"script: {clip(text, 80)}"), []
    if name == "spawn_agent":
        return "spawning a helper agent", []
    return name, []


def user_text(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(i.get("text") or "") for i in content if isinstance(i, dict) and i.get("type") == "text")
    return ""


def injected(text: str) -> bool:
    head = text.lstrip()
    return not head or head.startswith("<") or head.startswith("[Request interrupted") or head.startswith("# AGENTS.md")


def claude_digest(path: Path) -> dict:
    activity, files, helpers, pending = [], [], {}, {}
    first = last_prompt = last_said = cwd = model = ""
    ended = False
    for record in records(path):
        cwd = record.get("cwd") or cwd
        kind = record.get("type")
        message = record.get("message") if isinstance(record.get("message"), dict) else {}
        if kind == "user":
            content = message.get("content")
            results = [i for i in content if isinstance(i, dict) and i.get("type") == "tool_result"] if isinstance(content, list) else []
            if results:
                for item in results:
                    pending.pop(str(item.get("tool_use_id")), None)
                    helpers.pop(str(item.get("tool_use_id")), None)
                continue
            text = user_text(content)
            if text and not injected(text):
                first = first or text
                last_prompt = clip(text, 280)
                activity.append({"kind": "ask", "text": clip(text, 120)})
                ended = False
        elif kind == "assistant":
            model = message.get("model") or model
            for item in message.get("content") or []:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "text" and str(item.get("text") or "").strip():
                    last_said = clip(item["text"], 400)
                    activity.append({"kind": "say", "text": clip(item["text"], 140)})
                elif item.get("type") == "tool_use":
                    line, changed = describe_claude_tool(str(item.get("name") or ""), item.get("input") or {})
                    activity.append({"kind": "tool", "text": line})
                    pending[str(item.get("id"))] = line
                    if item.get("name") in ("Agent", "Task"):
                        data = item.get("input") if isinstance(item.get("input"), dict) else {}
                        helpers[str(item.get("id"))] = clip(data.get("description") or "helper", 60)
                    if changed:
                        short = short_path(changed)
                        files = [f for f in files if f != short] + [short]
                    ended = False
            if message.get("stop_reason") == "end_turn":
                ended = True
        elif kind == "system" and record.get("subtype") == "turn_duration":
            ended = True
    now_line = list(pending.values())[-1] if pending else (activity[-1]["text"] if activity else "")
    return {
        "activity": activity[-12:], "files": files[-8:], "lastPrompt": last_prompt, "lastSaid": last_said,
        "now": clip(now_line, 120), "ended": ended, "model": model, "cwd": cwd, "title": clip(first, 60),
        "helpers": [] if ended else list(helpers.values())[-6:],
    }


def codex_head(path: Path) -> tuple[str, str]:
    """The working directory and first request, from the top of a rollout."""
    cwd = first = ""
    try:
        head = read_bytes(path, tail=None)[:256 * 1024] if is_compressed(path) else path.open("rb").read(256 * 1024)
    except OSError:
        return cwd, first
    for line in head.decode("utf-8", errors="replace").splitlines():
        try:
            record = json.loads(line)
        except ValueError:
            continue
        payload = record.get("payload") if isinstance(record, dict) and isinstance(record.get("payload"), dict) else {}
        cwd = cwd or payload.get("cwd") or ""
        if not first and payload.get("type") == "message" and payload.get("role") == "user":
            text = " ".join(str(c.get("text") or "") for c in payload.get("content") or [] if isinstance(c, dict))
            if text.strip() and not injected(text):
                first = text
        if cwd and first:
            break
    return cwd, first


def codex_digest(path: Path) -> dict:
    activity, files = [], []
    first = last_prompt = last_said = cwd = model = ""
    ended = False
    cwd, first = codex_head(path)
    for record in records(path, tail=None if is_compressed(path) else TAIL_BYTES * 2):
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        kind = record.get("type")
        if kind in ("session_meta", "turn_context"):
            cwd = payload.get("cwd") or cwd
            model = payload.get("model") or model
        if kind == "event_msg":
            if payload.get("type") in {"task_complete", "task_completed", "turn_aborted", "task_cancelled"}:
                ended = True
            elif payload.get("type") == "task_started":
                ended = False
        if kind == "response_item" and payload.get("type") == "message" and payload.get("role") in ("user", "assistant"):
            text = " ".join(str(c.get("text") or "") for c in payload.get("content") or [] if isinstance(c, dict))
            if not text.strip() or injected(text):
                continue
            if payload["role"] == "user":
                first = first or text
                last_prompt = clip(text, 280)
                activity.append({"kind": "ask", "text": clip(text, 120)})
            else:
                last_said = clip(text, 400)
                activity.append({"kind": "say", "text": clip(text, 140)})
        elif kind == "response_item" and payload.get("type") in {"function_call", "custom_tool_call", "local_shell_call"}:
            line, touched = describe_codex_tool(str(payload.get("name") or ""), payload.get("arguments") or payload.get("input") or "")
            activity.append({"kind": "tool", "text": line})
            for item in touched:
                short = short_path(item)
                files = [f for f in files if f != short] + [short]
    return {
        "activity": activity[-12:], "files": files[-8:], "lastPrompt": last_prompt, "lastSaid": last_said,
        "now": clip(activity[-1]["text"] if activity else "", 120), "ended": ended, "model": model, "cwd": cwd,
        "title": clip(first, 60), "helpers": [],
    }


_digests: dict[str, tuple[tuple, dict]] = {}


def digest(kind: str, path: Path) -> dict:
    stat = path.stat()
    key = (stat.st_size, stat.st_mtime)
    cached = _digests.get(str(path))
    if cached and cached[0] == key:
        return cached[1]
    result = codex_digest(path) if kind == "codex" else claude_digest(path)
    _digests[str(path)] = (key, result)
    return result


_projects: dict[str, str] = {}


def project_of(cwd: str) -> str:
    """The repository a session works in; a git worktree counts as its parent repo."""
    if cwd in _projects:
        return _projects[cwd]
    name = ""
    path = Path(cwd or "")
    for folder in [path, *path.parents]:
        if folder == HOME or folder == folder.parent:
            break
        marker = folder / ".git"
        if marker.is_dir():
            name = folder.name
            break
        if marker.is_file():
            try:
                gitdir = Path(marker.read_text(encoding="utf-8").strip().removeprefix("gitdir:").strip())
            except OSError:
                gitdir = Path()
            name = gitdir.parents[2].name if "worktrees" in gitdir.parts else folder.name
            break
    name = name or (path.name if cwd else "unknown")
    _projects[cwd] = name
    return name


def sessions(now: float) -> list[tuple[str, str, Path]]:
    """(agent kind, session id, transcript) for sessions written recently."""
    found = []
    if CLAUDE_PROJECTS.is_dir():
        for path in CLAUDE_PROJECTS.glob("*/*.jsonl"):
            try:
                if now - path.stat().st_mtime < RECENT_SECONDS:
                    found.append(("claude", path.stem, path))
            except OSError:
                continue
    for days_back in (0, 1):
        folder = CODEX_SESSIONS / time.strftime("%Y/%m/%d", time.localtime(now - days_back * 86400))
        if not folder.is_dir():
            continue
        for path in folder.iterdir():
            if not path.name.startswith("rollout-") or not (path.name.endswith(".jsonl") or path.name.endswith(".jsonl.zst")):
                continue
            try:
                if now - path.stat().st_mtime < RECENT_SECONDS:
                    sid = re.sub(r"\.jsonl(\.zst)?$", "", path.name)[-36:]
                    found.append(("codex", sid, path))
            except OSError:
                continue
    return found


_commits: dict = {"at": 0.0, "value": []}


def recent_commits(repos: set[str], now: float) -> list[dict]:
    """Your commits from the last week in the repositories agents worked in."""
    if now - _commits["at"] < 300:
        return _commits["value"]
    value = []
    for repo in sorted(repos):
        try:
            email = subprocess.run(["git", "-C", repo, "config", "user.email"], capture_output=True, text=True, timeout=5).stdout.strip()
            out = subprocess.run(
                ["git", "-C", repo, "log", "--since=7.days", f"--author={email}", "--format=%H%x09%ct%x09%s", "-n", "200"],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in out.splitlines():
            sha, _, rest = line.partition("\t")
            stamp, _, subject = rest.partition("\t")
            if sha:
                value.append({"key": sha[:12], "title": clip(subject, 90), "at": int(stamp or 0)})
    _commits.update(at=now, value=value)
    return value


def repo_root(cwd: str) -> str:
    path = Path(cwd or "")
    for folder in [path, *path.parents]:
        if (folder / ".git").exists():
            return str(folder)
    return ""


def collect(machine: str) -> dict:
    now = time.time()
    agents, repos = [], set()
    for kind, sid, path in sessions(now):
        try:
            info = digest(kind, path)
            mtime = path.stat().st_mtime
        except OSError:
            continue
        fresh = now - mtime < WORKING_SECONDS
        state = "working" if fresh and not info["ended"] else "done" if info["ended"] else "idle"
        root = repo_root(info["cwd"])
        if root:
            repos.add(root)
        agents.append({
            "id": sid, "agent": kind, "title": info["title"] or project_of(info["cwd"]),
            "project": project_of(info["cwd"]), "cwd": info["cwd"], "branch": "", "machine": machine,
            "pane": False, "group": None, "parent": None, "run": None, "state": state, "lastActive": mtime,
            "model": info["model"], "now": info["now"], "lastPrompt": info["lastPrompt"], "lastSaid": info["lastSaid"],
            "files": info["files"], "activity": info["activity"], "helpers": info["helpers"], "path": str(path),
        })
    agents.sort(key=lambda a: -a["lastActive"])
    return {
        "machine": machine, "at": now, "agents": agents[:MAX_AGENTS], "ceo": {"state": "idle"}, "runs": [],
        "usage": {}, "tasks": [], "economy": {"commits": recent_commits(repos, now)},
        # This feeder only reads; a feeder that can type into live sessions or
        # start new ones advertises send/hire and handles those job modes.
        "capabilities": {"send": False, "hire": False},
    }


# --- demo ------------------------------------------------------------------

DEMO_WORK = [
    ("editing src/api/users.ts", "Add pagination to the users endpoint"),
    ("$ npm test -- users", "Add pagination to the users endpoint"),
    ("reading docs/architecture.md", "Write the onboarding guide"),
    ("$ pytest tests/test_billing.py", "Fix the proration rounding bug"),
    ("editing app/billing/invoice.py", "Fix the proration rounding bug"),
    ("$ gh pr create --fill", "Bump dependencies"),
    ("web: react 19 migration notes", "Upgrade to React 19"),
    ("delegating: audit the call sites", "Upgrade to React 19"),
    ("searching TODO", "Clean up dead code"),
]


def demo(machine: str, tick: int) -> dict:
    rng = random.Random(tick // 8)
    agents = []
    for i, (now_line, task) in enumerate(DEMO_WORK):
        state = rng.choice(["working", "working", "working", "waiting", "idle", "done"])
        agents.append({
            "id": f"demo-{i:02d}-0000-0000-0000-000000000000", "agent": "codex" if i % 3 == 0 else "claude",
            "title": task, "project": ["web-app", "billing", "docs"][i % 3], "cwd": "", "branch": "main",
            "machine": machine, "pane": False, "state": state, "lastActive": time.time() - rng.randint(0, 600),
            "model": "", "now": now_line, "lastPrompt": task, "lastSaid": "On it." if state == "working" else "DONE: shipped it.",
            "files": [now_line.split(" ")[-1]] if now_line.startswith("editing") else [],
            "activity": [{"kind": "ask", "text": task}, {"kind": "tool", "text": now_line}],
            "helpers": ["audit the call sites"] if now_line.startswith("delegating") and state == "working" else [],
        })
    return {"machine": machine, "at": time.time(), "agents": agents, "ceo": {"state": "working"}, "runs": [],
            "usage": {}, "tasks": [], "economy": {}, "capabilities": {"send": False, "hire": False}}


# --- peek jobs -------------------------------------------------------------


def session_log(agent: dict) -> str:
    path = Path(agent.get("path") or "")
    if not path.is_file():
        return "\n".join(f"{i['kind'].upper()}: {i['text']}" for i in agent.get("activity", []))
    lines = []
    for record in records(path, tail=1536 * 1024 if not is_compressed(path) else None):
        message = record.get("message") if isinstance(record.get("message"), dict) else {}
        payload = record.get("payload") if isinstance(record.get("payload"), dict) else {}
        if record.get("type") == "user":
            text = user_text(message.get("content"))
            if text and not injected(text):
                lines.append(f"BOSS: {clip(text, 900)}")
        elif record.get("type") == "assistant":
            for item in message.get("content") or []:
                if isinstance(item, dict) and item.get("type") == "text":
                    lines.append(f"ME: {clip(item.get('text'), 1500)}")
                elif isinstance(item, dict) and item.get("type") == "tool_use":
                    lines.append(f"TOOL: {describe_claude_tool(str(item.get('name') or ''), item.get('input') or {})[0]}")
        elif record.get("type") == "response_item" and payload.get("type") == "message":
            text = " ".join(str(c.get("text") or "") for c in payload.get("content") or [] if isinstance(c, dict))
            if text.strip() and not injected(text):
                lines.append(f"{'BOSS' if payload.get('role') == 'user' else 'ME'}: {clip(text, 1200)}")
    return "\n".join(lines)[-24000:]


def answer(job: dict, latest: dict) -> str:
    agent = next((a for a in latest.get("agents", []) if a["id"] == job.get("agentId")), None)
    if agent is None:
        return "I'm not on this machine right now, so I can't say."
    if str(agent["id"]).startswith("demo-"):
        return f"I'm on '{agent['title']}'. Right now: {agent['now']}."
    history = "\n".join(f"BOSS: {h.get('q')}\nYOU: {h.get('a')}" for h in job.get("history") or [])
    context = (
        f"Your session so far (BOSS is your boss, ME is you, TOOL is what you ran):\n{session_log(agent)}\n\n"
        f"Right now you are {agent['state']}, in project {agent['project']}.\n\n"
        + (f"What the two of you just said:\n{history}\n\n" if history else "")
        + f"BOSS: {clip(job.get('question'), 600)}"
    )
    system = (
        f"You are {job.get('name') or 'an agent'}, a {agent['agent']} coding agent working on '{agent['title']}'. "
        "Your boss walked over to your desk. Answer as yourself, in first person, specific and concrete, from your "
        "session log only, in two to five sentences. Follow the thread of the conversation. You cannot run anything "
        "from here; if asked to act, say what you would do. Never invent facts. Plain text, no markdown."
    )
    claude = shutil.which("claude")
    if not claude:
        return f"Right now: {agent['now'] or 'nothing in particular'}. Last request: {agent['lastPrompt'] or 'none'}."
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    command = [claude, "-p", "--setting-sources", "", "--model", os.environ.get("OFFICE_ASK_MODEL", "sonnet"),
               "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--system-prompt", system, context]
    try:
        result = subprocess.run(command, cwd=WORK_DIR, capture_output=True, text=True, timeout=90)
        if result.returncode == 0 and result.stdout.strip():
            return clip(result.stdout, 1800)
    except (OSError, subprocess.TimeoutExpired) as exc:
        log(f"peek failed: {exc}")
    return f"Right now: {agent['now'] or 'nothing in particular'}. Last request: {agent['lastPrompt'] or 'none'}."


def job_loop(hub: str, token: str, machine: str, latest: dict) -> None:
    while True:
        try:
            reply = http_json(f"{hub}/api/jobs?machine={machine}", token=token, timeout=40)
        except (OSError, ValueError, urllib.error.URLError):
            time.sleep(5)
            continue
        for job in reply.get("jobs") or []:
            def run(job=job):
                mode = job.get("mode")
                text = answer(job, latest) if mode in (None, "ask") else f"(This feeder can't {mode}.)"
                try:
                    http_json(f"{hub}/api/jobs/{job['id']}", body={"text": text}, token=token, timeout=10)
                except (OSError, ValueError, urllib.error.URLError) as exc:
                    log(f"job reply failed: {exc}")

            threading.Thread(target=run, daemon=True).start()


def main() -> int:
    load_env()
    hub = os.environ.get("OFFICE_HUB_URL", "").rstrip("/")
    token = os.environ.get("OFFICE_TOKEN", "")
    machine = os.environ.get("OFFICE_MACHINE") or socket.gethostname().split(".")[0]
    demo_mode = "--demo" in sys.argv
    if not hub or not token:
        log(f"set OFFICE_HUB_URL and OFFICE_TOKEN (environment or {ENV_FILE})")
        return 2
    latest: dict = {}
    threading.Thread(target=job_loop, args=(hub, token, machine, latest), daemon=True).start()
    log(f"feeding {hub} as {machine}{' (demo)' if demo_mode else ''}")
    last_body, last_push, tick = "", 0.0, 0
    while True:
        started = time.time()
        tick += 1
        try:
            snapshot = demo(machine, tick) if demo_mode else collect(machine)
            latest.clear()
            latest.update(snapshot)
            outgoing = {**snapshot, "agents": [{k: v for k, v in a.items() if k != "path"} for a in snapshot["agents"]]}
            body = json.dumps({k: v for k, v in outgoing.items() if k != "at"}, sort_keys=True)
            if body != last_body or started - last_push > HEARTBEAT_SECONDS:
                http_json(f"{hub}/api/ingest", body=outgoing, token=token, timeout=8)
                last_body, last_push = body, started
        except (OSError, ValueError, urllib.error.URLError) as exc:
            log(f"push failed: {exc}")
        time.sleep(max(0.5, PUSH_SECONDS - (time.time() - started)))


if __name__ == "__main__":
    raise SystemExit(main())
