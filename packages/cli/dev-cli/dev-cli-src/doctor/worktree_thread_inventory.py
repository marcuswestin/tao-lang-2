"""Read local agent task indexes without changing their databases or transcripts.

Input: {"paths": [absolute worktree paths], "home": optional fixture home} on stdin.
Fixtures can also supply "platform" and "xdgConfigHome" instead of process defaults.
Output: provider coverage and exact-path task matches as one JSON object on stdout.
An unreadable installed provider is reported as unavailable, never as an empty task list.
"""

import json
import os
from pathlib import Path
import re
import sqlite3
import stat
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


def record(app, id, path, title, description, created, updated, archived=False,
           label=None, last_activity=None):
    return {
        "app": app,
        "id": str(id),
        "path": canonical(path),
        "title": summary(title, 90) or "Untitled task",
        "description": summary(description),
        "createdAt": created,
        "lastActivityAt": updated,
        "lastActivity": summary(last_activity, 240) if last_activity else None,
        "label": label,
        "archived": bool(archived),
    }


def codex_last_activity(home, thread_id):
    history = home / ".codex" / "thread_history_1.sqlite"
    if not history.is_file():
        return None, None
    try:
        with sqlite3.connect(f"file:{history}?mode=ro", uri=True) as db:
            row = db.execute(
                "SELECT completed_at, turn_id FROM thread_turns "
                "WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1", (thread_id,),
            ).fetchone()
            if not row:
                return None, None
            for item_type in ("userMessage", "agentMessage"):
                items = db.execute(
                    "SELECT item_json FROM thread_items WHERE thread_id=? AND turn_id=? "
                    "AND item_type=? ORDER BY rollout_ordinal DESC", (thread_id, row[1], item_type),
                )
                for (raw,) in items:
                    item = json.loads(raw)
                    if item_type == "agentMessage" and item.get("phase") != "final_answer":
                        continue
                    value = item.get("content", [{}]) if item_type == "userMessage" else item.get("text")
                    if isinstance(value, list):
                        value = " ".join(block.get("text", "") for block in value if isinstance(block, dict))
                    if summary(value):
                        return iso(row[0]), ("User: " if item_type == "userMessage" else "Agent: ") + summary(value, 220)
            return iso(row[0]), None
    except (OSError, sqlite3.Error, ValueError, TypeError):
        return None, None


def codex_threads(home, wanted):
    directory = home / ".codex"
    if not directory.exists():
        return "not-installed", []
    databases = sorted(directory.glob("state_*.sqlite"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not databases:
        return "unavailable: no state database", []
    with sqlite3.connect(f"file:{databases[0]}?mode=ro", uri=True) as db:
        rows = db.execute(
            "SELECT t.id,t.cwd,t.name,t.title,t.first_user_message,t.created_at,t.updated_at,"
            "t.created_at_ms,t.updated_at_ms,t.archived,t.thread_source,s.name "
            "FROM threads t LEFT JOIN thread_sections s ON s.id=t.thread_section_id"
        )
        result = []
        for row in rows:
            id, cwd, name, title, first, created, updated, created_ms, updated_ms, archived, source, label = row
            if not cwd or source == "guardian_review" or canonical(cwd) not in wanted:
                continue
            activity_at, activity = codex_last_activity(home, id)
            result.append(record(
                "codex", id, cwd, name or title or first, first,
                iso(created_ms, True) or iso(created), activity_at or iso(updated_ms, True) or iso(updated),
                archived, label, activity,
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
                last_activity="Transcript updated; inspect the task for the last conversation turn.",
            ))
    return "ok", result


def cursor_threads(home, platform, xdg_config_home):
    # Covers the default profile only; arbitrary --user-data-dir profiles are not discovered.
    if platform == "darwin":
        app_root = home / "Library" / "Application Support" / "Cursor"
    elif platform == "linux":
        config_root = Path(xdg_config_home) if xdg_config_home else home / ".config"
        if not config_root.is_absolute():
            config_root = home / ".config"
        app_root = config_root / "Cursor"
    else:
        return "unavailable: unsupported platform", []
    # Walk parents too: a dangling symlink or inaccessible ancestor is not absence.
    for directory in reversed((app_root, *app_root.parents)):
        try:
            directory.lstat()
        except FileNotFoundError:
            return "not-installed", []
        if not stat.S_ISDIR(directory.stat().st_mode):
            return "unavailable: user data path is not a directory", []
    db_path = app_root / "User" / "globalStorage" / "state.vscdb"
    if not stat.S_ISREG(db_path.stat().st_mode):
        return "unavailable: composer database is not a file", []
    with sqlite3.connect(db_path.as_uri() + "?mode=ro", uri=True) as db:
        rows = db.execute("SELECT composerId,createdAt,lastUpdatedAt,isArchived,value FROM composerHeaders")
        result = []
        for id, created, updated, archived, raw in rows:
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise ValueError("invalid composer record")
            workspace = value.get("workspaceIdentifier", {})
            if not isinstance(workspace, dict) or not isinstance(workspace.get("uri", {}), dict):
                raise ValueError("invalid composer workspace")
            path = workspace.get("uri", {}).get("fsPath")
            if path is not None and not isinstance(path, str):
                raise ValueError("invalid composer path")
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
        ("codex", lambda: codex_threads(home, wanted)),
        ("claude", lambda: claude_threads(home, wanted)),
        ("cursor", lambda: cursor_threads(
            home, request.get("platform", sys.platform),
            request.get("xdgConfigHome", os.environ.get("XDG_CONFIG_HOME", "")),
        )),
    ):
        try:
            providers[app], threads = reader()
            for thread in threads:
                if thread["path"] in wanted:
                    by_path[thread["path"]].append(thread)
        except (OSError, sqlite3.Error, ValueError, KeyError, TypeError) as error:
            providers[app] = f"unavailable: {type(error).__name__}"
    for threads in by_path.values():
        threads.sort(key=lambda thread: (thread["lastActivityAt"] or "", thread["id"]), reverse=True)
    json.dump({"providers": providers, "byPath": by_path}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
