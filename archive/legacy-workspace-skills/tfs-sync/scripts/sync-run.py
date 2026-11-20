#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from tfs_sync_common import MulticaClient, SyncError, load_config, resolve_runtime_context
from reconcile_workitem import reconcile_file


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class RunLock:
    def __init__(self, path: Path):
        self.path = path
        self.acquired = False

    def acquire(self):
        try:
            self.path.mkdir(parents=False, exist_ok=False)
        except FileExistsError as exc:
            owner_file = self.path / "owner.json"
            owner = None
            if owner_file.exists():
                try:
                    owner = json.loads(owner_file.read_text(encoding="utf-8"))
                except Exception:
                    owner = None
            raise SyncError(
                "SYNC_ALREADY_RUNNING",
                f"检测到已有 tfs-sync 写入锁: {self.path}",
                details=owner,
            ) from exc
        self.acquired = True
        (self.path / "owner.json").write_text(
            json.dumps(
                {
                    "pid": os.getpid(),
                    "created_at": utc_now(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def release(self):
        if not self.acquired:
            return
        try:
            owner = self.path / "owner.json"
            if owner.exists():
                owner.unlink()
            self.path.rmdir()
        finally:
            self.acquired = False

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, exc_type, exc, tb):
        self.release()


def default_config() -> Path:
    return SCRIPT_DIR.parent / "config" / "config.toml"


def natural_key(path: Path):
    stem = path.stem
    return (0, int(stem)) if stem.isdigit() else (1, stem)


def aggregate(results: list[dict]) -> dict:
    delivery = Counter()
    creation_validation = Counter()
    activation_validation = Counter()
    failed = 0
    conflicts = 0

    conflict_codes = {
        "DELIVERY_DUPLICATE",
        "IDENTITY_MISMATCH",
        "CREATION_RECOVERY_CONFLICT",
    }

    for result in results:
        delivery[result.get("delivery_action", "UNKNOWN")] += 1
        validation = result.get("creation_validation") or {}
        creation_validation[validation.get("result", "UNKNOWN")] += 1
        activation = result.get("activation_validation") or {}
        activation_validation[activation.get("result", "UNKNOWN")] += 1
        errors = result.get("errors") or []
        validation_result = validation.get("result")
        validation_reasons = validation.get("reasons") or []
        item_failed = (bool(errors)
                       or validation_result in {"FAIL", "UNKNOWN", "ERROR"}
                       or activation.get("result") in {"FAIL", "UNKNOWN", "ERROR"})
        if item_failed:
            failed += 1
            error_conflict = any(
                e.get("code") in conflict_codes for e in errors if isinstance(e, dict)
            )
            validation_conflict = any(
                r.get("code") in {
                    "DELIVERY_ASSIGNEE_MISMATCH",
                    "DELIVERY_ASSIGNEE_TYPE_MISMATCH",
                    "DELIVERY_METADATA_MISMATCH",
                }
                for r in validation_reasons
                if isinstance(r, dict)
            )
            if error_conflict or validation_conflict:
                conflicts += 1

    return {
        "queried": len(results),
        "delivery_actions": dict(delivery),
        "creation_validation": dict(creation_validation),
        "activation_validation": dict(activation_validation),
        "conflicts": conflicts,
        "failed": failed,
        "failed_item_ids": [
            str(result.get("tfs_id"))
            for result in results
            if (result.get("errors")
                or (result.get("creation_validation") or {}).get("result") in {"FAIL", "UNKNOWN", "ERROR"}
                or (result.get("activation_validation") or {}).get("result") in {"FAIL", "UNKNOWN", "ERROR"})
        ],
        "retryable_item_ids": [
            str(result.get("tfs_id"))
            for result in results
            if result.get("errors") and result.get("retryable")
        ],
    }


def summary_result(counts: dict) -> str:
    """统一批次状态，禁止以 COMPLETED 掩盖单项失败。"""

    return "COMPLETED" if not counts["failed"] else "PARTIAL_FAILURE"


def reconcile_with_retries(
    raw_file: Path,
    *,
    client: MulticaClient,
    ctx,
    run_dir: Path,
    apply: bool,
    max_attempts: int,
    base_delay_seconds: float,
) -> dict:
    """仅重放网络暂态失败；每次重新读取权威身份和创建恢复线索。"""

    for attempt in range(max_attempts):
        result = reconcile_file(raw_file, client=client, ctx=ctx, run_dir=run_dir, apply=apply)
        result["attempts"] = attempt + 1
        if not result.get("errors") or not result.get("retryable") or attempt + 1 >= max_attempts:
            return result
        delay = max(0, base_delay_seconds) * (2**attempt)
        if delay:
            time.sleep(delay)

    raise AssertionError("max_attempts 至少为 1，循环必须返回结果。")


def main() -> int:
    p = argparse.ArgumentParser(description="Batch reconcile TFS raw JSON files into Multica.")
    p.add_argument("--config", type=Path, default=default_config())
    p.add_argument("--raw-dir", type=Path)
    p.add_argument("--run-dir", type=Path)
    p.add_argument("--collection")
    p.add_argument("--project")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--summary-file", type=Path)
    args = p.parse_args()

    lock = None
    try:
        config = load_config(args.config)
        runtime_cfg = config.get("runtime", {})
        tfs_cfg = config.get("tfs", {})
        mc_cfg = config.get("multica", {})

        work_root = Path(runtime_cfg.get("work_dir", ".tmp"))
        run_dir = args.run_dir
        if run_dir is None:
            if args.raw_dir:
                run_dir = args.raw_dir.parent
            else:
                raise SyncError("MISSING_RUN_DIR", "必须提供 --run-dir 或 --raw-dir。")
        raw_dir = args.raw_dir or (run_dir / "raw")
        result_dir = run_dir / "results"
        result_dir.mkdir(parents=True, exist_ok=True)

        files = sorted(raw_dir.glob("*.json"), key=natural_key)
        max_items = int(tfs_cfg.get("max_items_per_run", 200))
        if len(files) > max_items:
            raise SyncError(
                "MAX_ITEMS_EXCEEDED",
                f"raw JSON 数量 {len(files)} 超过 max_items_per_run={max_items}。",
            )

        binary = mc_cfg.get("binary", "multica")
        timeout = int(mc_cfg.get("cli_timeout_seconds", 30))
        client = MulticaClient(
            binary,
            timeout,
            read_retry_attempts=int(mc_cfg.get("read_retry_attempts", 0)),
            read_retry_base_delay_seconds=float(mc_cfg.get("read_retry_base_delay_seconds", 1)),
            read_retry_max_delay_seconds=float(mc_cfg.get("read_retry_max_delay_seconds", 8)),
        )

        # 整个批次只做一次 CLI 能力检查、Project/Squad 解析。
        ctx = resolve_runtime_context(
            config,
            client,
            collection_override=args.collection,
            project_override=args.project,
            skip_preflight=False,
        )

        stop_on_failure = bool(runtime_cfg.get("stop_on_item_failure", False))
        retryable_item_attempts = max(1, int(runtime_cfg.get("retryable_item_attempts", 1)))
        retryable_item_base_delay_seconds = float(
            runtime_cfg.get("retryable_item_base_delay_seconds", 1)
        )
        results = []

        if args.apply:
            lock = RunLock(work_root / ".sync-lock")
            lock.acquire()

        try:
            for raw_file in files:
                result = reconcile_with_retries(
                    raw_file,
                    client=client,
                    ctx=ctx,
                    run_dir=run_dir,
                    apply=args.apply,
                    max_attempts=retryable_item_attempts,
                    base_delay_seconds=retryable_item_base_delay_seconds,
                )
                results.append(result)
                out = result_dir / f"{raw_file.stem}.result.json"
                out.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )

                validation_result = (result.get("creation_validation") or {}).get("result")
                activation_result = (result.get("activation_validation") or {}).get("result")
                item_failed = bool(result.get("errors")) or validation_result in {
                    "FAIL", "UNKNOWN", "ERROR"
                } or activation_result in {"FAIL", "UNKNOWN", "ERROR"}
                if stop_on_failure and item_failed:
                    break
        finally:
            if lock:
                lock.release()

        counts = aggregate(results)
        summary = {
            "result": summary_result(counts),
            "apply": args.apply,
            "started_from_raw_dir": str(raw_dir),
            "collection": ctx.collection,
            "project_id": ctx.project_id,
            "delivery_squad_ref": ctx.delivery_squad_ref,
            "delivery_squad_id": ctx.delivery_squad_id,
            "wayfinder_agent_ref": ctx.wayfinder_agent_ref,
            "wayfinder_agent_id": ctx.wayfinder_agent_id,
            "completed_at": utc_now(),
            "counts": counts,
            "items": results,
        }

        summary_path = args.summary_file or (run_dir / "summary.json")
        summary_path.parent.mkdir(parents=True, exist_ok=True)
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 1 if counts["failed"] else 0

    except SyncError as exc:
        if lock:
            lock.release()
        result = {"result": "FAILED", "errors": [exc.as_dict()]}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1
    except Exception as exc:
        if lock:
            lock.release()
        result = {
            "result": "FAILED",
            "errors": [{"code": "UNEXPECTED_ERROR", "message": str(exc)}],
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
