from __future__ import annotations

import html
import json
import os
import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable

try:
    import tomllib
except ImportError as exc:  # Python < 3.11
    raise RuntimeError("Python 3.11+ is required because tfs-sync uses tomllib.") from exc


class SyncError(RuntimeError):
    def __init__(self, code: str, message: str, *, details: Any = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details

    def as_dict(self):
        data = {"code": self.code, "message": self.message}
        if self.details is not None:
            data["details"] = self.details
        return data


def is_retryable_multica_error(code: str, details: Any = None) -> bool:
    """仅标记网络暂态错误；权限和参数错误绝不能自动重试。"""

    if code == "MULTICA_CLI_TIMEOUT":
        return True
    if code != "MULTICA_CLI_FAILED":
        return False
    text = str(details or "").lower()
    markers = (
        "could not reach",
        "connection",
        "network",
        "temporarily unavailable",
        "connection reset",
    )
    return any(marker in text for marker in markers)


class _TextExtractor(HTMLParser):
    BLOCK_TAGS = {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "tr"}
    SKIP_TAGS = {"script", "style"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip_depth = 0

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag == "br":
            self.parts.append("\n")
        elif tag == "li":
            self.parts.append("\n- ")
        elif tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
            return
        if self.skip_depth:
            return
        if tag in self.BLOCK_TAGS or tag == "li":
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)

    def text(self):
        text = "".join(self.parts)
        text = html.unescape(text)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n[ \t]+", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()


def html_to_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value)
    if "<" not in text or ">" not in text:
        return text.strip()
    parser = _TextExtractor()
    parser.feed(text)
    return parser.text()


def load_config(path: Path) -> dict:
    if not path.exists():
        raise SyncError("CONFIG_NOT_FOUND", f"配置文件不存在: {path}")
    with path.open("rb") as f:
        return tomllib.load(f)


def env_or_default(env_name: str | None, default: Any) -> Any:
    if env_name:
        value = os.getenv(env_name)
        if value is not None and value != "":
            return value
    return default


def scalar_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, dict):
        for key in ("displayName", "name", "uniqueName", "value"):
            if key in value and value[key] is not None:
                return str(value[key])
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def deep_get(data: Any, dotted: str) -> Any:
    cur = data
    for part in dotted.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def pick(data: dict, *keys: str) -> Any:
    fields = data.get("fields", {}) if isinstance(data, dict) else {}
    for key in keys:
        if key.startswith("$."):
            value = deep_get(data, key[2:])
            if value is not None:
                return value
        if isinstance(data, dict) and key in data:
            return data[key]
        if isinstance(fields, dict) and key in fields:
            return fields[key]
    return None


def normalize_changed_date(value: Any) -> str:
    if value is None or str(value).strip() == "":
        raise SyncError("MISSING_CHANGED_DATE", "TFS Work Item 缺少 ChangedDate。")
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise SyncError("INVALID_CHANGED_DATE", f"无法解析 ChangedDate: {value}") from exc
    if dt.tzinfo is None:
        raise SyncError("INVALID_CHANGED_DATE", "ChangedDate 必须包含时区。")
    dt = dt.astimezone(timezone.utc)
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_changed_date(value: str) -> datetime:
    text = normalize_changed_date(value)
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def compare_changed_date(current: str, stored: str | None) -> str:
    if not stored:
        return "MISSING_STORED"
    a = parse_changed_date(current)
    b = parse_changed_date(stored)
    if a == b:
        return "SAME"
    if a > b:
        return "NEWER"
    return "STALE_SOURCE"


def normalize_workitem(data: dict) -> dict:
    wid = pick(data, "id", "System.Id", "ID")
    wtype = pick(data, "type", "System.WorkItemType", "WorkItemType")
    title = pick(data, "title", "System.Title", "Title")
    changed = pick(data, "changedDate", "System.ChangedDate", "ChangedDate")

    missing = []
    if wid is None:
        missing.append("id")
    if not wtype:
        missing.append("type")
    if not title:
        missing.append("title")
    if not changed:
        missing.append("changed_at")
    if missing:
        raise SyncError(
            "MISSING_REQUIRED_TFS_FIELD",
            "TFS Work Item 缺少必填字段: " + ", ".join(missing),
        )

    url = pick(data, "url", "URL", "$._links.html.href", "$._links.self.href")

    return {
        "id": str(wid),
        "type": str(wtype),
        "title": str(title).strip(),
        "changed_at": normalize_changed_date(changed),
        "state": scalar_string(pick(data, "state", "System.State", "State")),
        "description": html_to_text(pick(data, "description", "System.Description", "Description")),
        "acceptance_criteria": html_to_text(
            pick(
                data,
                "acceptanceCriteria",
                "Microsoft.VSTS.Common.AcceptanceCriteria",
                "AcceptanceCriteria",
            )
        ),
        "repro_steps": html_to_text(
            pick(
                data,
                "reproSteps",
                "Microsoft.VSTS.TCM.ReproSteps",
                "ReproSteps",
            )
        ),
        "priority": pick(
            data,
            "priority",
            "Microsoft.VSTS.Common.Priority",
            "Priority",
        ),
        "tags": scalar_string(pick(data, "tags", "System.Tags", "Tags")),
        "area_path": scalar_string(pick(data, "areaPath", "System.AreaPath", "AreaPath")),
        "iteration_path": scalar_string(
            pick(data, "iterationPath", "System.IterationPath", "IterationPath")
        ),
        "assigned_to": scalar_string(
            pick(data, "assignedTo", "System.AssignedTo", "AssignedTo")
        ),
        "url": scalar_string(url),
    }


def priority_to_multica(value: Any) -> str:
    if value is None or value == "":
        return "none"
    try:
        n = int(value)
    except (TypeError, ValueError):
        return "none"
    return {1: "urgent", 2: "high", 3: "medium", 4: "low"}.get(n, "none")


def delivery_title(item: dict) -> str:
    return f"[TFS #{item['id']}] {item['title']}"


def build_delivery_description(item: dict) -> str:
    lines = ["## TFS 工作项", ""]
    pairs = [
        ("ID", f"#{item['id']}"),
        ("类型", item.get("type")),
        ("状态", item.get("state")),
        ("Area", item.get("area_path")),
        ("Iteration", item.get("iteration_path")),
        ("负责人", item.get("assigned_to")),
        ("最后修改时间", item.get("changed_at")),
        ("来源", item.get("url")),
    ]
    for label, value in pairs:
        if value:
            lines.append(f"- {label}: {value}")
    sections = [
        ("描述", item.get("description")),
        ("验收标准", item.get("acceptance_criteria")),
        ("复现步骤", item.get("repro_steps")),
    ]
    for title, body in sections:
        if body:
            lines.extend(["", f"## {title}", "", body])
    return "\n".join(lines).strip() + "\n"



def extract_rows(payload: Any, preferred_keys: Iterable[str] = ()) -> list[dict]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]
    if isinstance(payload, dict):
        for key in preferred_keys:
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
        for key in ("issues", "items", "results", "data", "projects", "agents", "squads"):
            value = payload.get(key)
            if isinstance(value, list):
                return [x for x in value if isinstance(x, dict)]
        if "id" in payload:
            return [payload]
    return []


def obj_id(obj: dict) -> str | None:
    for key in ("id", "uuid", "issue_id", "agent_id", "project_id", "squad_id"):
        value = obj.get(key)
        if value:
            return str(value)
    return None


def obj_name(obj: dict) -> str | None:
    for key in ("name", "title", "display_name", "identifier", "slug"):
        value = obj.get(key)
        if value:
            return str(value)
    return None



def issue_assignee_id(issue: dict) -> str | None:
    value = issue.get("assignee_id")
    if value:
        return str(value)
    assignee = issue.get("assignee")
    if isinstance(assignee, dict):
        return obj_id(assignee)
    return None


def issue_assignee_type(issue: dict) -> str | None:
    value = issue.get("assignee_type")
    if value:
        return str(value).lower()
    assignee = issue.get("assignee")
    if isinstance(assignee, dict):
        value = assignee.get("type") or assignee.get("assignee_type")
        if value:
            return str(value).lower()
    return None


def issue_status(issue: dict) -> str | None:
    value = issue.get("status")
    if isinstance(value, dict):
        return str(value.get("key") or value.get("name") or "") or None
    return str(value) if value else None


def issue_project_id(issue: dict) -> str | None:
    value = issue.get("project_id")
    if value:
        return str(value)
    project = issue.get("project")
    if isinstance(project, dict):
        return obj_id(project)
    return None


def issue_metadata(issue: dict) -> dict:
    value = issue.get("metadata")
    return value if isinstance(value, dict) else {}


def string_metadata_filter(key: str, value: str) -> str:
    # CLI 会把纯数字解析成 number；这里强制把字符串编码成 JSON string。
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        # `--metadata` is parsed by the CLI as CSV before its RHS is JSON
        # decoded. Quote the complete filter and double the embedded JSON
        # quotes so they survive that CSV pass.
        encoded = json.dumps(value).replace(chr(34), chr(34) * 2)
        return f'{chr(34)}{key}={encoded}{chr(34)}'
    return f"{key}={value}"


@dataclass
class RuntimeContext:
    collection: str
    project_ref: str
    project_id: str
    delivery_squad_ref: str
    delivery_squad_id: str
    wayfinder_agent_ref: str
    wayfinder_agent_id: str
    multica_bin: str
    timeout: int
    work_dir: Path


class MulticaClient:
    def __init__(
        self,
        binary: str,
        timeout: int = 30,
        *,
        read_retry_attempts: int = 0,
        read_retry_base_delay_seconds: float = 1,
        read_retry_max_delay_seconds: float = 8,
    ):
        self.binary = binary
        self.timeout = timeout
        self.read_retry_attempts = max(0, read_retry_attempts)
        self.read_retry_base_delay_seconds = max(0, read_retry_base_delay_seconds)
        self.read_retry_max_delay_seconds = max(0, read_retry_max_delay_seconds)

    def run(
        self,
        args: list[str],
        *,
        expect_json: bool = False,
        check: bool = True,
        retryable_read: bool = False,
    ) -> Any:
        """执行 CLI；写操作不在此处重试，以免在结果未知时重复写入。"""

        cmd = [self.binary, *args]
        attempts = self.read_retry_attempts if retryable_read else 0
        for attempt in range(attempts + 1):
            try:
                p = subprocess.run(
                    cmd,
                    text=True,
                    capture_output=True,
                    timeout=self.timeout,
                    shell=False,
                )
            except FileNotFoundError as exc:
                raise SyncError("MULTICA_CLI_NOT_FOUND", f"找不到 Multica CLI: {self.binary}") from exc
            except subprocess.TimeoutExpired as exc:
                error = SyncError("MULTICA_CLI_TIMEOUT", f"命令超时: {' '.join(cmd)}")
            else:
                if check and p.returncode != 0:
                    stderr = (p.stderr or "").strip()
                    stdout = (p.stdout or "").strip()
                    msg = stderr or stdout or f"exit={p.returncode}"
                    code = "MULTICA_PERMISSION_DENIED" if "permission" in msg.lower() else "MULTICA_CLI_FAILED"
                    error = SyncError(code, f"Multica CLI 执行失败: {' '.join(cmd)}", details=msg)
                else:
                    if expect_json:
                        raw = (p.stdout or "").strip()
                        if not raw:
                            return {}
                        try:
                            return json.loads(raw)
                        except json.JSONDecodeError as exc:
                            raise SyncError(
                                "MULTICA_JSON_INVALID",
                                f"Multica CLI 未返回合法 JSON: {' '.join(cmd)}",
                                details=raw[:1000],
                            ) from exc
                    return p

            if attempt >= attempts or not is_retryable_multica_error(error.code, error.details):
                raise error
            delay = min(
                self.read_retry_base_delay_seconds * (2**attempt),
                self.read_retry_max_delay_seconds,
            )
            if delay:
                time.sleep(delay)

    def help_text(self, args: list[str]) -> str:
        p = self.run([*args, "--help"], check=False)
        return ((p.stdout or "") + "\n" + (p.stderr or "")).strip()

    def preflight(self):
        checks = [
            (["issue", "list"], ["--metadata", "--output"]),
            (["issue", "get"], ["--output"]),
            (["issue", "create"], ["--description-file", "--status", "--project", "--output"]),
            (["issue", "update"], ["--description-file", "--no-start"]),
            (["issue", "assign"], ["--to-id", "--no-start"]),
            (["issue", "search"], ["--include-closed"]),
            (["issue", "metadata", "set"], ["--key", "--value"]),
            (["project", "list"], ["--output"]),
            (["squad", "list"], ["--output"]),
            (["agent", "list"], ["--output"]),
            (["issue", "status"], ["--no-start"]),
        ]
        missing = []
        for command, flags in checks:
            text = self.help_text(command)
            for flag in flags:
                if flag not in text:
                    missing.append({"command": " ".join(command), "flag": flag})
        if missing:
            raise SyncError(
                "CLI_CAPABILITY_MISSING",
                "当前 Multica CLI 缺少 tfs-sync 所需能力。",
                details=missing,
            )

    def resolve_project(self, ref: str) -> str:
        payload = self.run(
            ["project", "list", "--output", "json"], expect_json=True, retryable_read=True
        )
        rows = extract_rows(payload, ("projects",))
        matches = []
        for row in rows:
            rid = obj_id(row)
            name = obj_name(row)
            if rid == ref or name == ref:
                matches.append(row)
        if len(matches) != 1:
            raise SyncError(
                "PROJECT_RESOLVE_FAILED",
                f"Project 必须精确匹配且唯一: {ref}",
                details=[{"id": obj_id(x), "name": obj_name(x)} for x in matches],
            )
        rid = obj_id(matches[0])
        if not rid:
            raise SyncError("PROJECT_RESOLVE_FAILED", f"Project 缺少 ID: {ref}")
        return rid

    def resolve_agent(self, ref: str) -> str:
        payload = self.run(
            ["agent", "list", "--output", "json"], expect_json=True, retryable_read=True
        )
        rows = extract_rows(payload, ("agents",))
        matches = []
        for row in rows:
            rid = obj_id(row)
            name = obj_name(row)
            if rid == ref or name == ref:
                matches.append(row)
        if len(matches) != 1:
            raise SyncError(
                "AGENT_RESOLVE_FAILED",
                f"Agent 必须精确匹配且唯一: {ref}",
                details=[{"id": obj_id(x), "name": obj_name(x)} for x in matches],
            )
        rid = obj_id(matches[0])
        if not rid:
            raise SyncError("AGENT_RESOLVE_FAILED", f"Agent 缺少 ID: {ref}")
        return rid

    def resolve_squad(self, ref: str) -> str:
        payload = self.run(
            ["squad", "list", "--output", "json"], expect_json=True, retryable_read=True
        )
        rows = extract_rows(payload, ("squads",))
        matches = []
        for row in rows:
            rid = obj_id(row)
            name = obj_name(row)
            if rid == ref or name == ref:
                matches.append(row)
        if len(matches) != 1:
            raise SyncError(
                "SQUAD_RESOLVE_FAILED",
                f"Squad 必须精确匹配且唯一: {ref}",
                details=[{"id": obj_id(x), "name": obj_name(x)} for x in matches],
            )
        rid = obj_id(matches[0])
        if not rid:
            raise SyncError("SQUAD_RESOLVE_FAILED", f"Squad 缺少 ID: {ref}")
        return rid

    def list_by_metadata(self, pairs: list[tuple[str, str]], limit: int = 3) -> list[dict]:
        args = ["issue", "list"]
        for key, value in pairs:
            args += ["--metadata", string_metadata_filter(key, value)]
        args += ["--limit", str(limit), "--full-id", "--output", "json"]
        payload = self.run(args, expect_json=True, retryable_read=True)
        return extract_rows(payload, ("issues",))

    def search_issues(self, query: str, limit: int = 20) -> list[dict]:
        payload = self.run(
            ["issue", "search", query, "--include-closed", "--limit", str(limit), "--output", "json"],
            expect_json=True,
            retryable_read=True,
        )
        return extract_rows(payload, ("issues", "results"))

    def get_issue(self, issue_id: str) -> dict:
        payload = self.run(
            ["issue", "get", issue_id, "--output", "json"], expect_json=True, retryable_read=True
        )
        rows = extract_rows(payload, ("issues",))
        if rows:
            return rows[0]
        if isinstance(payload, dict):
            return payload
        raise SyncError("MULTICA_READ_FAILED", f"无法读取 Issue: {issue_id}")

    def create_issue(
        self,
        *,
        title: str,
        description_file: Path,
        status: str,
        priority: str,
        project_id: str,
    ) -> dict:
        args = [
            "issue", "create",
            "--title", title,
            "--description-file", str(description_file),
            "--status", status,
            "--priority", priority,
            "--project", project_id,
            "--output", "json",
        ]
        payload = self.run(args, expect_json=True)
        rows = extract_rows(payload, ("issues",))
        if rows:
            return rows[0]
        if isinstance(payload, dict):
            return payload
        raise SyncError("MULTICA_CREATE_FAILED", f"创建 Issue 后无法解析结果: {title}")

    def update_issue(
        self,
        issue_id: str,
        *,
        title: str | None = None,
        description_file: Path | None = None,
        priority: str | None = None,
    ):
        args = ["issue", "update", issue_id]
        if title is not None:
            args += ["--title", title]
        if description_file is not None:
            args += ["--description-file", str(description_file)]
        if priority is not None:
            args += ["--priority", priority]
        args += ["--no-start"]
        self.run(args)

    def assign_issue(self, issue_id: str, assignee_id: str):
        self.run(["issue", "assign", issue_id, "--to-id", assignee_id, "--no-start"])

    def activate_wayfinder(self, issue_id: str):
        # 只能在来源事实、Wayfinder Owner 与 backlog 都经回读确认后调用。
        # 本次写入不使用 --no-start，让 Multica 原生触发 Wayfinder Run。
        self.run(["issue", "status", issue_id, "todo"])

    def set_metadata(self, issue_id: str, key: str, value: str, *, force_string: bool = True):
        args = ["issue", "metadata", "set", issue_id, "--key", key, "--value", str(value)]
        if force_string:
            args += ["--type", "string"]
        self.run(args)

    def set_metadata_many(self, issue_id: str, values: dict[str, str]):
        for key, value in values.items():
            if value is None:
                continue
            self.set_metadata(issue_id, key, str(value), force_string=True)


def resolve_runtime_context(
    config: dict,
    client: MulticaClient,
    *,
    collection_override: str | None = None,
    project_override: str | None = None,
    skip_preflight: bool = False,
) -> RuntimeContext:
    tfs_cfg = config.get("tfs", {})
    mc_cfg = config.get("multica", {})
    delivery_cfg = config.get("delivery", {})
    runtime_cfg = config.get("runtime", {})

    collection = (
        collection_override
        or env_or_default(tfs_cfg.get("collection_env"), tfs_cfg.get("collection"))
        or ""
    )
    if not collection:
        raise SyncError("MISSING_TFS_COLLECTION", "未解析到 TFS Collection。")

    project_ref = (
        project_override
        or env_or_default(mc_cfg.get("project_env"), mc_cfg.get("project"))
        or ""
    )
    if mc_cfg.get("project_required", True) and not project_ref:
        raise SyncError("MISSING_PROJECT", "未解析到 Multica Project。")

    binary = env_or_default(mc_cfg.get("binary_env"), mc_cfg.get("binary", "multica"))
    timeout = int(mc_cfg.get("cli_timeout_seconds", 30))
    client.binary = binary
    client.timeout = timeout

    if not skip_preflight:
        client.preflight()

    project_id = client.resolve_project(project_ref)

    squad_name = str(delivery_cfg.get("squad") or "").strip()
    if not squad_name:
        raise SyncError("MISSING_REQUIRED_SQUAD", "delivery.squad 未配置。")
    squad_id = client.resolve_squad(squad_name)

    wayfinder_ref = str(
        env_or_default(
            delivery_cfg.get("wayfinder_agent_env"),
            delivery_cfg.get("wayfinder_agent"),
        ) or ""
    ).strip()
    if not wayfinder_ref:
        raise SyncError(
            "MISSING_WAYFINDER_AGENT",
            "delivery.wayfinder_agent 未配置；禁止回退为直接分配 Delivery Squad。",
        )
    wayfinder_id = client.resolve_agent(wayfinder_ref)

    work_dir = Path(runtime_cfg.get("work_dir", ".tmp"))

    return RuntimeContext(
        collection=collection,
        project_ref=project_ref,
        project_id=project_id,
        delivery_squad_ref=squad_name,
        delivery_squad_id=squad_id,
        wayfinder_agent_ref=wayfinder_ref,
        wayfinder_agent_id=wayfinder_id,
        multica_bin=binary,
        timeout=timeout,
        work_dir=work_dir,
    )
