#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""仓库 registry 的只读查询入口。

持久元数据只读取 repo-context.yaml；仓库是否在当前机器检出由本模块实时推导，
避免把某位开发者的磁盘状态写进共享 contract。
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import yaml


def _ensure_utf8_output() -> None:
    """把 stdout / stderr 切到 UTF-8；Windows 上 Python 默认 GBK，中文会静默变乱码。

    本模块输出 JSON 且含中文，GBK 编码后由 UTF-8 消费方（rondo）解码即成乱码。
    PYTHONUTF8=1 需在进程启动前设置才生效，故此处用 reconfigure 自举。
    """
    for stream in (sys.stdout, sys.stderr):
        encoding = (getattr(stream, "encoding", None) or "").lower()
        if encoding in ("utf-8", "utf8", "cp65001"):
            continue
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            reconfigure(encoding="utf-8", errors="replace")
        except (ValueError, OSError):
            pass


_ensure_utf8_output()

CONTRACT_VERSION = "repo-registry-result/v1"
REGISTRY_RELPATH = Path("docs/config/repo-context.yaml")


def find_workspace_root(start: Path | None = None) -> Path:
    """定位包含基础配置与 OpenSpec 的工作区根，兼容子仓和 worktree。"""
    base = (start or Path.cwd()).resolve()
    for candidate in (base, *base.parents):
        if ((candidate / REGISTRY_RELPATH).is_file()
                and (candidate / "openspec").is_dir()):
            return candidate
    return Path(__file__).resolve().parents[1]


def _normalize(value: object) -> str:
    return str(value or "").strip().replace("\\", "/").rstrip("/").lower()


@dataclass(frozen=True)
class RepoRecord:
    repo_id: str
    repo_path: str
    repo_type: str
    responsibility: str
    keywords: tuple[str, ...]
    not_responsible_for: tuple[str, ...]
    tfs_project: str | None = None
    tfs_collection: str | None = None
    repo_url: str | None = None
    default_target_branch: str | None = None

    def status(self, workspace_root: Path) -> str:
        path = Path(self.repo_path)
        target = path if path.is_absolute() else workspace_root / path
        return "present" if target.is_dir() else "missing-on-disk"

    def to_dict(self, workspace_root: Path) -> dict:
        return {
            "repo_id": self.repo_id,
            "repo_path": self.repo_path,
            "repo_url": self.repo_url,
            **({"default_target_branch": self.default_target_branch} if self.default_target_branch is not None else {}),
            "repo_type": self.repo_type,
            "repo_status": self.status(workspace_root),
            "responsibility": self.responsibility,
            "keywords": list(self.keywords),
            "not_responsible_for": list(self.not_responsible_for),
            "tfs_project": self.tfs_project,
            "tfs_collection": self.tfs_collection,
        }


def _result(operation: str, repos=(), errors=()):
    """所有操作统一返回稳定 JSON 形状，调用方不依赖私有实现细节。"""
    errors = list(errors)
    return {
        "contract_version": CONTRACT_VERSION,
        "operation": operation,
        "status": "error" if errors else "ok",
        "repos": [] if errors else list(repos),
        "errors": errors,
    }


class RepoRegistry:
    def __init__(self, records: list[RepoRecord], workspace_root: Path):
        self.records = records
        self.workspace_root = workspace_root
        self._identities: dict[str, list[RepoRecord]] = {}
        for record in records:
            for value in (record.repo_id, record.repo_path):
                key = _normalize(value)
                if key:
                    self._identities.setdefault(key, []).append(record)

    @classmethod
    def from_workspace(cls, workspace_root: Path | None = None) -> "RepoRegistry":
        root = Path(workspace_root) if workspace_root else find_workspace_root()
        path = root / REGISTRY_RELPATH
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        records = []
        for item in data.get("repos") or []:
            records.append(RepoRecord(
                repo_id=item["repo_id"], repo_path=item["repo_path"], repo_type=item["repo_type"], repo_url=item.get("repo_url"),
                default_target_branch=item.get("default_target_branch"),
                responsibility=item.get("responsibility", ""),
                keywords=tuple(item.get("keywords") or ()),
                not_responsible_for=tuple(item.get("not_responsible_for") or ()),
                tfs_project=item.get("tfs_project"), tfs_collection=item.get("tfs_collection"),
            ))
        return cls(records, root)

    def _serialized(self, records: list[RepoRecord]) -> list[dict]:
        return [record.to_dict(self.workspace_root) for record in records]

    def list(self, present_only: bool = False) -> dict:
        records = self.records if not present_only else [r for r in self.records if r.status(self.workspace_root) == "present"]
        return _result("list", self._serialized(records))

    def get(self, repo_id: str) -> dict:
        records = [r for r in self.records if r.repo_id == repo_id]
        return _result("get", self._serialized(records), () if len(records) == 1 else ("unknown_repo_identity",))

    def resolve(self, value: str) -> dict:
        records = self._identities.get(_normalize(value), [])
        unique = list({record.repo_id: record for record in records}.values())
        if not unique:
            return _result("resolve", errors=("unknown_repo_identity",))
        if len(unique) != 1:
            return _result("resolve", errors=("ambiguous_repo_identity",))
        return _result("resolve", self._serialized(unique))

    def match_keywords(self, text: str, limit: int | None = None) -> dict:
        """保留字面匹配供辅助检索；语义选仓由 LLM 读取 registry 后判断。"""
        content = text or ""
        ranked = [(sum(content.count(keyword) for keyword in record.keywords if keyword), record)
                  for record in self.records]
        records = [record for score, record in sorted(ranked, key=lambda item: (-item[0], item[1].repo_id)) if score]
        return _result("match-keywords", self._serialized(records[:limit] if limit is not None else records))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="只读仓库 registry 查询接口；语义选仓直接读取 repo-context.yaml")
    parser.add_argument("--workspace", type=Path)
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("list").add_argument("--present-only", action="store_true")
    sub.add_parser("get").add_argument("repo_id")
    sub.add_parser("resolve").add_argument("value")
    match = sub.add_parser("match-keywords"); match.add_argument("text"); match.add_argument("--limit", type=int)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    registry = RepoRegistry.from_workspace(args.workspace)
    if args.operation == "list": result = registry.list(args.present_only)
    elif args.operation == "get": result = registry.get(args.repo_id)
    elif args.operation == "resolve": result = registry.resolve(args.value)
    else: result = registry.match_keywords(args.text, args.limit)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
