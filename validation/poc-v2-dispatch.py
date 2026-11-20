"""仅用于隔离 PoC 的单主机确定性派工入口。"""

from __future__ import annotations

import argparse
import ctypes
import json
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


CONFIG_PATH = Path(__file__).with_name("poc-v2-dispatch-config.json")
SCRIPT_VERSION = "poc-v2-3"
MUTEX_NAME = "Global\\MulticaSquadDispatchV2BPoC20261014"
WAIT_OBJECT_0 = 0
WAIT_ABANDONED = 0x80
WAIT_TIMEOUT = 0x102


class DispatchError(Exception):
    """可见的保守停止原因。"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def cli(*args: str):
    # 所有读取和写入都经同一 CLI 入口；任何非零退出码停止派工。
    command = ["multica", *args, "--output", "json"]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", timeout=60)
    if result.returncode:
        raise DispatchError(f"CLI_FAILED:{' '.join(args[:3])}:exit={result.returncode}:{result.stderr[:300]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise DispatchError(f"INVALID_JSON:{' '.join(args[:3])}:{result.stdout[:120]}") from exc


def set_metadata(issue_id: str, key: str, value):
    return cli(
        "issue", "metadata", "set", issue_id,
        "--key", key,
        "--value", json.dumps(value, ensure_ascii=False, separators=(",", ":")),
    )


def metadata_record(value) -> dict:
    # 当前 CLI 将 JSON 对象存为字符串；读取时显式解码并拒绝损坏记录。
    if value is None:
        return {}
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise DispatchError("METADATA_RECORD_INVALID_JSON") from exc
    if not isinstance(value, dict):
        raise DispatchError("METADATA_RECORD_INVALID_TYPE")
    return value


def list_all(assignee_id: str, *, project_id: str | None = None):
    offset = 0
    rows = []
    while True:
        args = ["issue", "list", "--assignee-id", assignee_id, "--limit", "100", "--offset", str(offset)]
        if project_id:
            args += ["--project", project_id]
        page = cli(*args)
        if (
            not isinstance(page, dict)
            or not isinstance(page.get("issues"), list)
            or not isinstance(page.get("has_more"), bool)
            or not isinstance(page.get("total"), int)
        ):
            raise DispatchError("ISSUE_LIST_UNKNOWN")
        items = page["issues"]
        rows.extend(items)
        if not page.get("has_more"):
            if offset + len(items) != page["total"]:
                raise DispatchError("ISSUE_LIST_INCOMPLETE")
            return rows
        if not items:
            raise DispatchError("ISSUE_LIST_EMPTY_PAGE")
        offset += len(items)
        if offset > 10000:
            raise DispatchError("ISSUE_LIST_BOUND")


def is_pending(issue: dict, config: dict) -> bool:
    metadata = issue.get("metadata") or {}
    return (
        issue.get("workspace_id") == config["workspace_id"]
        and issue.get("project_id") == config["project_id"]
        and issue.get("parent_issue_id") is None
        and issue.get("assignee_type") == "agent"
        and issue.get("assignee_id") == config["coordinator_id"]
        and issue.get("status") == "todo"
        and metadata.get("dispatch_v2_eligible") is True
    )


def active_run_ids(issue_id: str) -> list[str]:
    runs = cli("issue", "runs", issue_id, "--active")
    if not isinstance(runs, list):
        raise DispatchError("RUN_LIST_UNKNOWN")
    return [run["id"] for run in runs if run.get("status") in {"queued", "running"}]


def occupied_issue_ids(squad_id: str, config: dict) -> list[str]:
    # 不加 Project 过滤：同一 Squad 跨 Project 承接的顶层交付也要计数。
    occupied = []
    for issue in list_all(squad_id):
        if issue.get("workspace_id") != config["workspace_id"]:
            raise DispatchError("OCCUPANCY_WORKSPACE_UNKNOWN")
        if issue.get("parent_issue_id") is not None:
            continue
        status = issue.get("status")
        if status not in {"done", "cancelled"}:
            occupied.append(issue["id"])
        elif active_run_ids(issue["id"]):
            occupied.append(issue["id"])
    return occupied


def assert_runtime_ready(leader_id: str, workspace_id: str):
    leader = cli("agent", "get", leader_id)
    if (
        leader.get("workspace_id") != workspace_id
        or leader.get("runtime_bound") is not True
        or leader.get("status") != "idle"
    ):
        raise DispatchError("LEADER_NOT_READY")
    runtime_id = leader.get("runtime_id")
    runtimes = cli("runtime", "list")
    if not isinstance(runtimes, list) or not any(
        item.get("id") == runtime_id
        and item.get("workspace_id") == workspace_id
        and item.get("status") == "online" for item in runtimes
    ):
        raise DispatchError("RUNTIME_NOT_READY")


def pending_attempt_for_target(target: str, config: dict) -> str | None:
    for issue in list_all(config["coordinator_id"], project_id=config["project_id"]):
        attempt = metadata_record((issue.get("metadata") or {}).get("dispatch_v2_attempt"))
        if attempt.get("target") == target and attempt.get("status") in {
            "pending", "unknown"
        }:
            return issue["id"]
    return None


def dispatch_one(issue_id: str, config: dict) -> dict:
    issue = cli("issue", "get", issue_id)
    if not is_pending(issue, config):
        return {"issue_id": issue_id, "outcome": "NOOP", "reason": "NOT_PENDING"}
    metadata = issue.get("metadata") or {}
    target = metadata.get("dispatch_v2_target")
    if target not in config["squads"]:
        return {"issue_id": issue_id, "outcome": "NEEDS_HUMAN", "reason": "INVALID_TARGET"}
    if metadata_record(metadata.get("dispatch_v2_attempt")).get("status") in {"pending", "unknown"}:
        return {"issue_id": issue_id, "outcome": "UNKNOWN", "reason": "PRIOR_ATTEMPT"}
    prior = pending_attempt_for_target(target, config)
    if prior:
        return {"issue_id": issue_id, "outcome": "UNKNOWN", "reason": "POOL_ATTEMPT", "prior_issue_id": prior}
    squad = config["squads"][target]
    occupied = occupied_issue_ids(target, config)
    if len(occupied) >= squad["capacity"]:
        result = {
            "issue_id": issue_id, "outcome": "WAIT_CAPACITY", "target": target,
            "occupied_ids": occupied, "capacity": squad["capacity"], "script_version": SCRIPT_VERSION,
            "checked_at": utc_now(),
        }
        set_metadata(issue_id, "dispatch_v2_observation", result)
        return result
    try:
        assert_runtime_ready(squad["leader_id"], config["workspace_id"])
    except DispatchError as exc:
        result = {"issue_id": issue_id, "outcome": "WAIT_RUNTIME", "target": target, "reason": str(exc)}
        set_metadata(issue_id, "dispatch_v2_observation", result)
        return result

    attempt = {
        "id": str(uuid.uuid4()), "target": target, "status": "pending",
        "observed_revision": issue["revision"], "created_at": utc_now(),
        "script_version": SCRIPT_VERSION,
    }
    set_metadata(issue_id, "dispatch_v2_attempt", attempt)
    current = cli("issue", "get", issue_id)
    if not is_pending(current, config):
        return {"issue_id": issue_id, "outcome": "UNKNOWN", "reason": "CHANGED_BEFORE_UPDATE", "attempt": attempt}
    attempt["update_revision"] = current["revision"]
    set_metadata(issue_id, "dispatch_v2_attempt", attempt)
    try:
        # 已验证的原生路径：一次 Update 同时设置 Status 与 Squad Owner。
        cli("issue", "update", issue_id, "--status", "todo", "--assignee-id", target)
    except Exception as exc:
        return {"issue_id": issue_id, "outcome": "UNKNOWN", "reason": f"UPDATE_UNCERTAIN:{exc}", "attempt": attempt}
    confirmed = cli("issue", "get", issue_id)
    if confirmed.get("assignee_type") != "squad" or confirmed.get("assignee_id") != target:
        return {"issue_id": issue_id, "outcome": "UNKNOWN", "reason": "OWNER_MISMATCH", "attempt": attempt}
    runs = cli("issue", "runs", issue_id)
    leader_runs = [run["id"] for run in runs if run.get("agent_id") == squad["leader_id"]]
    if len(leader_runs) != 1:
        return {
            "issue_id": issue_id, "outcome": "UNKNOWN", "reason": "LEADER_RUN_COUNT",
            "leader_runs": leader_runs, "attempt": attempt,
        }
    attempt["status"] = "confirmed"
    attempt["leader_run_id"] = leader_runs[0]
    attempt["confirmed_at"] = utc_now()
    set_metadata(issue_id, "dispatch_v2_attempt", attempt)
    return {
        "issue_id": issue_id, "outcome": "ASSIGNED", "target": target,
        "occupied_before": occupied, "attempt_id": attempt["id"],
        "leader_run_id": leader_runs[0], "script_version": SCRIPT_VERSION,
    }


def run() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("issue", "sweep"), required=True)
    parser.add_argument("--issue-id")
    options = parser.parse_args()
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if config["coordinator_id"] == "PENDING":
        raise DispatchError("COORDINATOR_NOT_CONFIGURED")
    if options.mode == "issue" and not options.issue_id:
        raise DispatchError("ISSUE_ID_REQUIRED")

    # Windows 命名 Mutex 在同机所有 Run 进程间互斥；崩溃后的接管保守停止。
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi = ctypes.WinDLL("advapi32", use_last_error=True)

    class SecurityAttributes(ctypes.Structure):
        _fields_ = [
            ("nLength", ctypes.c_uint32),
            ("lpSecurityDescriptor", ctypes.c_void_p),
            ("bInheritHandle", ctypes.c_int),
        ]

    descriptor = ctypes.c_void_p()
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        ctypes.c_wchar_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p
    ]
    advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = ctypes.c_int
    # Agent Runtime 与本机控制进程可能使用不同访问令牌；显式允许已认证用户共享互斥对象。
    if not advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW(
        "D:(A;;GA;;;AU)", 1, ctypes.byref(descriptor), None
    ):
        raise DispatchError(f"MUTEX_SECURITY_FAILED:{ctypes.get_last_error()}")
    attributes = SecurityAttributes(ctypes.sizeof(SecurityAttributes), descriptor, False)
    kernel.CreateMutexW.argtypes = [ctypes.POINTER(SecurityAttributes), ctypes.c_int, ctypes.c_wchar_p]
    kernel.CreateMutexW.restype = ctypes.c_void_p
    kernel.OpenMutexW.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_wchar_p]
    kernel.OpenMutexW.restype = ctypes.c_void_p
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    kernel.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    kernel.WaitForSingleObject.restype = ctypes.c_uint32
    kernel.ReleaseMutex.argtypes = [ctypes.c_void_p]
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = kernel.CreateMutexW(ctypes.byref(attributes), False, MUTEX_NAME)
    create_error = ctypes.get_last_error()
    kernel.LocalFree(descriptor)
    if not handle and create_error == 5:
        # 已存在时 CreateMutex 申请全权限可能失败，等待和释放只需要以下两项权限。
        handle = kernel.OpenMutexW(0x00100000 | 0x0001, False, MUTEX_NAME)
    if not handle:
        raise DispatchError(f"MUTEX_CREATE_FAILED:{create_error}:{ctypes.get_last_error()}")
    acquired = False
    try:
        wait_result = kernel.WaitForSingleObject(handle, 30000)
        acquired = wait_result in {WAIT_OBJECT_0, WAIT_ABANDONED}
        if wait_result == WAIT_TIMEOUT:
            raise DispatchError("MUTEX_TIMEOUT")
        if wait_result == WAIT_ABANDONED:
            raise DispatchError("MUTEX_ABANDONED_RECONCILE_REQUIRED")
        if wait_result != WAIT_OBJECT_0:
            raise DispatchError(f"MUTEX_ERROR:{wait_result}")
        if options.mode == "issue":
            results = [dispatch_one(options.issue_id, config)]
        else:
            queue = list_all(config["coordinator_id"], project_id=config["project_id"])
            queue = [issue for issue in queue if is_pending(issue, config)]
            queue.sort(key=lambda issue: (issue["created_at"], issue["id"]))
            results = [dispatch_one(issue["id"], config) for issue in queue[:10]]
        print(json.dumps({"mode": options.mode, "results": results, "checked_at": utc_now()}, ensure_ascii=False))
        return 0 if all(item["outcome"] in {"ASSIGNED", "WAIT_CAPACITY", "WAIT_RUNTIME", "NOOP"} for item in results) else 3
    finally:
        if acquired:
            kernel.ReleaseMutex(handle)
        kernel.CloseHandle(handle)


if __name__ == "__main__":
    try:
        sys.exit(run())
    except Exception as exc:
        print(json.dumps({"outcome": "UNKNOWN", "error": str(exc), "checked_at": utc_now()}, ensure_ascii=False))
        sys.exit(3)
