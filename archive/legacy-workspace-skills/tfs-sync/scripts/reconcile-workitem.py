#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from tfs_sync_common import (
    MulticaClient,
    SyncError,
    load_config,
    normalize_workitem,
    resolve_runtime_context,
)
from reconcile_workitem import reconcile_file


def default_config() -> Path:
    return SCRIPT_DIR.parent / "config" / "config.toml"


def main() -> int:
    p = argparse.ArgumentParser(description="Reconcile one TFS Work Item JSON into Multica.")
    p.add_argument("raw_json", nargs="?", type=Path)
    p.add_argument("--config", type=Path, default=default_config())
    p.add_argument("--collection")
    p.add_argument("--project")
    p.add_argument("--apply", action="store_true")
    p.add_argument("--skip-preflight", action="store_true")
    p.add_argument("--preflight-only", action="store_true")
    p.add_argument("--normalize-only", action="store_true")
    p.add_argument("--result-file", type=Path)
    args = p.parse_args()

    try:
        config = load_config(args.config)

        if args.normalize_only:
            if not args.raw_json:
                raise SyncError("MISSING_INPUT", "--normalize-only 需要 raw_json。")
            raw = json.loads(args.raw_json.read_text(encoding="utf-8"))
            result = {"result": "NORMALIZED", "workitem": normalize_workitem(raw)}
        else:
            mc_cfg = config.get("multica", {})
            binary = mc_cfg.get("binary", "multica")
            timeout = int(mc_cfg.get("cli_timeout_seconds", 30))
            client = MulticaClient(
                binary,
                timeout,
                read_retry_attempts=int(mc_cfg.get("read_retry_attempts", 0)),
                read_retry_base_delay_seconds=float(mc_cfg.get("read_retry_base_delay_seconds", 1)),
                read_retry_max_delay_seconds=float(mc_cfg.get("read_retry_max_delay_seconds", 8)),
            )

            ctx = resolve_runtime_context(
                config,
                client,
                collection_override=args.collection,
                project_override=args.project,
                skip_preflight=args.skip_preflight,
            )

            if args.preflight_only:
                result = {
                    "result": "PASS",
                    "collection": ctx.collection,
                    "project_id": ctx.project_id,
                    "delivery_squad_ref": ctx.delivery_squad_ref,
                    "delivery_squad_id": ctx.delivery_squad_id,
                    "wayfinder_agent_ref": ctx.wayfinder_agent_ref,
                    "wayfinder_agent_id": ctx.wayfinder_agent_id,
                }
            else:
                if not args.raw_json:
                    raise SyncError("MISSING_INPUT", "缺少 raw_json。")
                run_dir = args.raw_json.parent.parent if args.raw_json.parent.name == "raw" else ctx.work_dir
                result = reconcile_file(
                    args.raw_json,
                    client=client,
                    ctx=ctx,
                    run_dir=run_dir,
                    apply=args.apply,
                )

    except SyncError as exc:
        result = {"result": "FAILED", "errors": [exc.as_dict()]}
    except Exception as exc:
        result = {
            "result": "FAILED",
            "errors": [{"code": "UNEXPECTED_ERROR", "message": str(exc)}],
        }

    text = json.dumps(result, ensure_ascii=False, indent=2)
    print(text)

    if args.result_file:
        args.result_file.parent.mkdir(parents=True, exist_ok=True)
        args.result_file.write_text(text + "\n", encoding="utf-8")

    validation_result = (result.get("creation_validation") or {}).get("result")
    activation_result = (result.get("activation_validation") or {}).get("result")
    failed = (
        result.get("result") == "FAILED"
        or bool(result.get("errors"))
        or validation_result in {"FAIL", "UNKNOWN", "ERROR"}
        or activation_result in {"FAIL", "UNKNOWN", "ERROR"}
    )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
