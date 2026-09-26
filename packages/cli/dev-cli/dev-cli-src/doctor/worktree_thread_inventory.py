"""Read local agent task indexes without changing their databases or transcripts.

Input: {"paths": [absolute worktree paths], "home": optional fixture home} on stdin.
Output: provider coverage and exact-path task matches as one JSON object on stdout.
An unreadable installed provider is reported as unavailable, never as an empty task list.
"""

import json
import os
from pathlib import Path
import re
import sqlite3
import sys
from datetime import datetime, timezone


def canonical(path):
    return os.path.realpath(path)


def iso(value, milliseconds=False):
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    return datetime.fromtimestamp(value / (1000 if milliseconds else 1), timezone.utc).isoformat()


def summary(value, limit=140):
    if not isinstance(value, str):
        return ""
    match = re.search(r"<user_query>(.*?)</user_query>", value, re.DOTALL)
    if match:
        value = match.group(1)
    value = re.sub(r"<system-reminder>.*?</system-reminder>", " ", value, flags=re.DOTALL)
    value = re.sub(r"<[^>]+>", " ", value)
    value = " ".join(value.split())
    return value[: limit - 1] + "…" if len(value) > limit else value


def record(app, id, path, title, description, created, updated, archived=False):
    return {
        "app": app,
        "id": str(id),
        "path": canonical(path),
        "title": summary(title, 90) or "Untitled task",
        "description": summary(description),
        "createdAt": created,
        "lastActivityAt": updated,
        "archived": bool(archived),
    }


def codex_threads(home):
    directory = home / ".codex"
    if not directory.exists():
        return "not-installed", []
    databases = sorted(directory.glob("state_*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not databases:
        return "unavailable: no state database", []
    with sqlite3.connect(f"file:{databases[0]}?mode=ro", uri=True) as db:
        rows = db.execute(
            "SELECT id,cwd,name,title,first_user_message,created_at,updated_at,"
            "created_at_ms,updated_at_ms,archived,thread_source FROM threads"
        )
        result = []
        for row in rows:
            id, cwd, name, title, first, created, updated, created_ms, updated_ms, archived, source = row
            if not cwd or source == "guardian_review":
                continue
            result.append(record(
                "codex", id, cwd, name or title or first, first,
                iso(created_ms, True) or iso(created), iso(updated_ms, True) or iso(updated), archived,
            ))
        return "ok", result


def first_claude_records(path):
    cwd = None
    created = None
    description = ""
    with path.open(encoding="utf-8", errors="replace") as stream:
        for index, line in enumerate(stream):
            if index >= 80 or (cwd and description and created):
                break
            try:
                item = json.loads(line)
            except ValueError:
                continue
            cwd = cwd or item.get("cwd")
            created = created or item.get("timestamp")
            if item.get("type") != "user" or description:
                continue
            message = item.get("message", {})
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str):
                description = summary(content)
            elif isinstance(content, list):
                description = summary(" ".join(
                    block.get("text", "") for block in content if isinstance(block, dict) and block.get("type") == "text"
                ))
    return cwd, created, description


def last_claude_timestamp(path):
    with path.open("rb") as stream:
        stream.seek(0, os.SEEK_END)
        stream.seek(max(0, stream.tell() - 262144))
        tail = stream.read().splitlines()
    for line in reversed(tail):
        try:
            timestamp = json.loads(line).get("timestamp")
            if isinstance(timestamp, str):
                return timestamp
        except ValueError:
            pass
    return iso(path.stat().st_mtime)


def claude_threads(home, wanted):
    root = home / ".claude" / "projects"
    if not root.exists():
        return "not-installed", []
    result = []
    for project in root.iterdir():
        if not project.is_dir():
            continue
        for transcript in project.glob("*.jsonl"):
            cwd, created, description = first_claude_records(transcript)
            if not cwd or canonical(cwd) not in wanted:
                continue
            title_path = project / transcript.stem / "custom-title.json"
            title = ""
            if title_path.is_file():
                try:
                    title = json.loads(title_path.read_text()).get("customTitle", "")
                except (ValueError, OSError):
                    pass
            result.append(record(
                "claude", transcript.stem, cwd, title or description or transcript.stem,
                description, created or iso(getattr(transcript.stat(), "st_birthtime", transcript.stat().st_ctime)),
                last_claude_timestamp(transcript),
            ))
    return "ok", result


def cursor_threads(home):
    root = home / "Library" / "Application Support" / "Cursor" / "User" / "globalStorage"
    db_path = root / "state.vscdb"
    if not root.exists():
        return "not-installed", []
    if not db_path.exists():
        return "unavailable: no composer database", []
    with sqlite3.connect(f"file:{db_path}?mode=ro", uri=True) as db:
        rows = db.execute("SELECT composerId,createdAt,lastUpdatedAt,isArchived,value FROM composerHeaders")
        result = []
        for id, created, updated, archived, raw in rows:
            try:
                value = json.loads(raw)
            except (TypeError, ValueError):
                continue
            path = value.get("workspaceIdentifier", {}).get("uri", {}).get("fsPath")
            if not path:
                continue
            result.append(record(
                "cursor", id, path, value.get("name"), value.get("subtitle"),
                iso(created, True), iso(updated, True), archived,
            ))
        return "ok", result


def main():
    request = json.load(sys.stdin)
    paths = [canonical(path) for path in request["paths"]]
    wanted = set(paths)
    home = Path(request.get("home", str(Path.home())))
    providers = {}
    by_path = {path: [] for path in paths}
    for app, reader in (
        ("codex", lambda: codex_threads(home)),
        ("claude", lambda: claude_threads(home, wanted)),
        ("cursor", lambda: cursor_threads(home)),
    ):
        try:
            providers[app], threads = reader()
            for thread in threads:
                if thread["path"] in wanted:
                    by_path[thread["path"]].append(thread)
        except (OSError, sqlite3.Error, ValueError, KeyError) as error:
            providers[app] = f"unavailable: {type(error).__name__}"
    for threads in by_path.values():
        threads.sort(key=lambda thread: (thread["lastActivityAt"] or "", thread["id"]), reverse=True)
    json.dump({"providers": providers, "byPath": by_path}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
