"""为共享 session-replay 导出器分配输出目录。"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def build_replay_dir_name(started_at: object, session_id: str) -> str:
    """按本地开始时间和 session 前八位生成兼容的目录名。"""

    try:
        parsed = datetime.fromisoformat(str(started_at).replace("Z", "+00:00"))
        stamp = parsed.astimezone().strftime("%Y%m%d-%H%M")
    except (TypeError, ValueError):
        stamp = str(started_at or "-")
    return f"{stamp}-{session_id[:8]}"


def allocate_replay_dir(
    out_root: Path,
    started_at: object,
    session_id: str,
) -> Path:
    """同一 session 复用目录，不同 session 原子分配后缀目录。"""

    out_root.mkdir(parents=True, exist_ok=True)
    base_name = build_replay_dir_name(started_at, session_id)
    sequence = 1
    while True:
        candidate = out_root / (base_name if sequence == 1 else f"{base_name}-{sequence}")
        try:
            candidate.mkdir(parents=False, exist_ok=False)
            return candidate
        except FileExistsError:
            replay_path = candidate / "replay.json"
            try:
                existing = json.loads(replay_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                existing = {}
            if isinstance(existing, dict) and existing.get("session_id") == session_id:
                return candidate
            sequence += 1
