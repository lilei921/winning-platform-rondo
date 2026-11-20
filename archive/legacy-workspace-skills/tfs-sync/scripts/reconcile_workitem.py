from __future__ import annotations

import json
from pathlib import Path

from tfs_sync_common import (
    MulticaClient,
    RuntimeContext,
    SyncError,
    build_delivery_description,
    compare_changed_date,
    delivery_title,
    issue_assignee_id,
    issue_assignee_type,
    issue_metadata,
    issue_project_id,
    issue_status,
    is_retryable_multica_error,
    normalize_workitem,
    obj_id,
    priority_to_multica,
)


def _write_text(path: Path, content: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _identity_values(item: dict, ctx: RuntimeContext) -> dict[str, str]:
    return {
        "source": "tfs",
        "tfs.collection": ctx.collection,
        "tfs.id": item["id"],
    }


def _tfs_metadata(item: dict, ctx: RuntimeContext) -> dict[str, str | None]:
    return {
        **_identity_values(item, ctx),
        "tfs.changed_at": item["changed_at"],
        "tfs.type": item["type"],
        "tfs.url": item.get("url"),
    }


def _set_tfs_metadata(
    client: MulticaClient,
    issue_id: str,
    item: dict,
    ctx: RuntimeContext,
):
    client.set_metadata_many(issue_id, _tfs_metadata(item, ctx))


def _identity_conflicts(metadata: dict, item: dict, ctx: RuntimeContext) -> list[dict]:
    conflicts = []
    for key, expected in _identity_values(item, ctx).items():
        actual = metadata.get(key)
        if actual not in (None, "") and str(actual) != str(expected):
            conflicts.append({"key": key, "expected": expected, "actual": actual})
    return conflicts


def _find_creation_recovery_candidate(
    client: MulticaClient,
    item: dict,
    ctx: RuntimeContext,
) -> dict | None:
    """保守恢复创建结果未知的 Delivery Issue；长期身份仍只认 TFS metadata。"""

    title = delivery_title(item)
    rows = client.search_issues(f"[TFS #{item['id']}]")
    exact: list[dict] = []
    for row in rows:
        if str(row.get("title") or "") != title:
            continue
        pid = issue_project_id(row)
        if pid and pid != ctx.project_id:
            continue
        exact.append(row)

    if len(exact) > 1:
        raise SyncError(
            "CREATION_RECOVERY_CONFLICT",
            f"TFS #{item['id']} 存在多个同标题 Delivery Issue，无法安全恢复创建。",
            details=[obj_id(x) for x in exact],
        )
    if not exact:
        return None

    issue_id = obj_id(exact[0])
    if not issue_id:
        raise SyncError(
            "CREATION_RECOVERY_CONFLICT",
            f"TFS #{item['id']} 的恢复候选缺少 Issue ID。",
        )

    full = client.get_issue(issue_id)
    if issue_status(full) != "backlog":
        raise SyncError(
            "CREATION_RECOVERY_CONFLICT",
            f"TFS #{item['id']} 的同标题 Issue 已离开 backlog，不能视为未完成创建。",
            details={"issue_id": issue_id, "status": issue_status(full)},
        )

    conflicts = _identity_conflicts(issue_metadata(full), item, ctx)
    if conflicts:
        raise SyncError(
            "CREATION_RECOVERY_CONFLICT",
            f"TFS #{item['id']} 的同标题 Issue 存在冲突身份 metadata。",
            details=conflicts,
        )
    return full


def _validate_created_delivery(
    delivery: dict,
    *,
    expected_wayfinder_id: str,
    expected_collection: str,
    expected_tfs_id: str,
) -> dict:
    reasons: list[dict] = []

    if not obj_id(delivery):
        reasons.append({"code": "DELIVERY_MISSING", "message": "Delivery Issue 缺少 ID。"})

    status = issue_status(delivery)
    if status != "backlog":
        reasons.append(
            {
                "code": "DELIVERY_STATUS_MISMATCH",
                "message": "新建 Delivery Issue 必须保持 backlog。",
                "expected": "backlog",
                "actual": status,
            }
        )

    assignee_id = issue_assignee_id(delivery)
    if assignee_id != expected_wayfinder_id:
        reasons.append(
            {
                "code": "DELIVERY_ASSIGNEE_MISMATCH",
                "message": "新建 Delivery Issue 必须分配给配置的 Wayfinder Agent。",
                "expected": expected_wayfinder_id,
                "actual": assignee_id,
            }
        )

    assignee_type = issue_assignee_type(delivery)
    if assignee_type and assignee_type != "agent":
        reasons.append(
            {
                "code": "DELIVERY_ASSIGNEE_TYPE_MISMATCH",
                "message": "新建 Delivery Issue 的负责人类型必须为 agent。",
                "actual": assignee_type,
            }
        )

    md = issue_metadata(delivery)
    required = {
        "source": "tfs",
        "tfs.collection": expected_collection,
        "tfs.id": expected_tfs_id,
    }
    for key, expected in required.items():
        actual = md.get(key)
        if str(actual or "") != str(expected):
            reasons.append(
                {
                    "code": "DELIVERY_METADATA_MISMATCH",
                    "message": f"新建 Delivery Issue metadata 不符合要求: {key}",
                    "expected": expected,
                    "actual": actual,
                }
            )

    if not md.get("tfs.changed_at"):
        reasons.append(
            {
                "code": "DELIVERY_METADATA_MISSING",
                "message": "新建 Delivery Issue 缺少 metadata: tfs.changed_at",
            }
        )

    return {
        "result": "FAIL" if reasons else "PASS",
        "status": status,
        "reasons": reasons,
    }


def _complete_creation(
    delivery: dict,
    *,
    client: MulticaClient,
    item: dict,
    ctx: RuntimeContext,
) -> dict:
    issue_id = obj_id(delivery)
    if not issue_id:
        raise SyncError(
            "DELIVERY_CREATE_RESULT_UNKNOWN",
            f"Delivery Issue 创建后缺少 ID: TFS #{item['id']}",
        )

    _set_tfs_metadata(client, issue_id, item, ctx)
    client.assign_issue(issue_id, ctx.wayfinder_agent_id)
    return client.get_issue(issue_id)


def reconcile_one(
    raw_data: dict,
    *,
    client: MulticaClient,
    ctx: RuntimeContext,
    run_dir: Path,
    apply: bool,
) -> dict:
    item = normalize_workitem(raw_data)
    tfs_id = item["id"]
    priority = priority_to_multica(item.get("priority"))

    rendered_dir = run_dir / "rendered"
    delivery_desc = rendered_dir / f"{tfs_id}.delivery.md"

    result = {
        "tfs_id": tfs_id,
        "changed_at": item["changed_at"],
        "delivery_action": "NONE",
        "creation_validation": {"result": "NOT_APPLICABLE", "reasons": []},
        "activation_validation": {"result": "NOT_APPLICABLE", "reasons": []},
        "delivery_status": None,
        "errors": [],
        "apply": apply,
    }

    delivery_matches = client.list_by_metadata(
        [
            ("source", "tfs"),
            ("tfs.collection", ctx.collection),
            ("tfs.id", tfs_id),
        ],
        limit=3,
    )

    if len(delivery_matches) > 1:
        raise SyncError(
            "DELIVERY_DUPLICATE",
            f"TFS #{tfs_id} 匹配到多个 Delivery Issue。",
            details=[obj_id(x) for x in delivery_matches],
        )

    delivery = delivery_matches[0] if delivery_matches else None

    if delivery is None:
        recovery = _find_creation_recovery_candidate(client, item, ctx)

        if not apply:
            result["delivery_action"] = "WOULD_RECOVER_CREATE" if recovery else "WOULD_CREATE"
            result["delivery_status"] = issue_status(recovery) if recovery else "backlog"
            result["creation_validation"] = {
                "result": "WOULD_VALIDATE_AFTER_CREATE",
                "status": result["delivery_status"],
                "reasons": [],
            }
            result["activation_validation"] = {"result": "WOULD_ACTIVATE", "reasons": []}
            return result

        if recovery is None:
            _write_text(delivery_desc, build_delivery_description(item))
            try:
                delivery = client.create_issue(
                    title=delivery_title(item),
                    description_file=delivery_desc,
                    status="backlog",
                    priority=priority,
                    project_id=ctx.project_id,
                )
            except SyncError as exc:
                if not is_retryable_multica_error(exc.code, exc.details):
                    raise
                recovery = _find_creation_recovery_candidate(client, item, ctx)
                if recovery is None:
                    raise
                delivery = recovery
                result["delivery_action"] = "RECOVERED_CREATE"
            else:
                if not obj_id(delivery):
                    recovery = _find_creation_recovery_candidate(client, item, ctx)
                    if recovery is None:
                        raise SyncError(
                            "DELIVERY_CREATE_RESULT_UNKNOWN",
                            f"Delivery Issue 创建后无法唯一恢复: TFS #{tfs_id}",
                        )
                    delivery = recovery
                    result["delivery_action"] = "RECOVERED_CREATE"
                else:
                    result["delivery_action"] = "CREATED"
        else:
            delivery = recovery
            result["delivery_action"] = "RECOVERED_CREATE"

        # 来源事实 / Wayfinder Owner 必须先回读确认，再触发一次正常 Run。
        delivery = _complete_creation(
            delivery,
            client=client,
            item=item,
            ctx=ctx,
        )
        result["delivery_status"] = issue_status(delivery)
        result["creation_validation"] = _validate_created_delivery(
            delivery,
            expected_wayfinder_id=ctx.wayfinder_agent_id,
            expected_collection=ctx.collection,
            expected_tfs_id=tfs_id,
        )
        if result["creation_validation"]["result"] != "PASS":
            return result

        issue_id = obj_id(delivery)
        try:
            client.activate_wayfinder(issue_id)
        except SyncError as exc:
            # 写入可能已经成功；不能自动补做第二次 status/rerun。
            try:
                result["delivery_status"] = issue_status(client.get_issue(issue_id))
            except SyncError:
                pass
            result["activation_validation"] = {
                "result": "UNKNOWN",
                "reasons": [{"code": "WAYFINDER_ACTIVATION_RESULT_UNKNOWN",
                             "message": "激活结果未知；需回读 Issue / Run 后人工判断恢复。"}],
            }
            result["errors"].append({
                "code": "WAYFINDER_ACTIVATION_RESULT_UNKNOWN",
                "message": "Wayfinder 激活写入失败或超时；禁止盲目重试。",
                "details": exc.as_dict(),
            })
            return result

        try:
            current = client.get_issue(issue_id)
        except SyncError as exc:
            result["activation_validation"] = {
                "result": "UNKNOWN",
                "reasons": [{"code": "WAYFINDER_ACTIVATION_READBACK_UNKNOWN",
                             "message": "激活已提交，但 Issue 回读失败。"}],
            }
            result["errors"].append({
                "code": "WAYFINDER_ACTIVATION_READBACK_UNKNOWN",
                "message": "需核对 Issue / Run 后再恢复，不得二次激活。",
                "details": exc.as_dict(),
            })
            return result

        status = issue_status(current)
        owner = issue_assignee_id(current)
        result["delivery_status"] = status
        # Wayfinder 可能已完成准入并移交 Squad，不要求仍保持 todo/Wayfinder。
        # 但任意未知 Owner / Status 或来源版本变化都不能伪装成激活成功。
        valid_wayfinder = (
            owner == ctx.wayfinder_agent_id
            and status in {"todo", "in_progress", "blocked", "unsupported"}
        )
        valid_squad = (
            owner == ctx.delivery_squad_id
            and status in {"backlog", "todo", "in_progress", "analysis_review", "in_review", "done"}
        )
        current_md = issue_metadata(current)
        source_matches = (
            str(current_md.get("tfs.id") or "") == tfs_id
            and current_md.get("tfs.changed_at") == item["changed_at"]
        )
        if (valid_wayfinder or valid_squad) and source_matches:
            result["activation_validation"] = {
                "result": "PASS",
                "observed_status": status,
                "observed_assignee_id": owner,
                "reasons": [],
            }
        else:
            result["activation_validation"] = {
                "result": "UNKNOWN",
                "observed_status": status,
                "observed_assignee_id": owner,
                "reasons": [{"code": "WAYFINDER_ACTIVATION_NOT_CONFIRMED",
                             "message": "激活后 Owner / Status / 来源版本与预期不一致；需检查实际 Run。"}],
            }
            result["errors"].append({
                "code": "WAYFINDER_ACTIVATION_NOT_CONFIRMED",
                "message": "不能证实一次预期激活；禁止再次触发。",
            })
        # 激活 PASS 不等于 Wayfinder Triage 已完成或 Runtime Run 已成功。
        return result

    delivery_id = obj_id(delivery)
    if not delivery_id:
        raise SyncError("IDENTITY_MISMATCH", f"Delivery Issue 缺少 ID: TFS #{tfs_id}")

    full_delivery = client.get_issue(delivery_id)
    md = issue_metadata(full_delivery)
    conflicts = _identity_conflicts(md, item, ctx)
    if conflicts:
        raise SyncError(
            "IDENTITY_MISMATCH",
            f"Delivery Issue 身份 metadata 与 TFS #{tfs_id} 冲突。",
            details=conflicts,
        )

    stored_changed = md.get("tfs.changed_at")
    change_state = compare_changed_date(item["changed_at"], stored_changed)

    if change_state == "STALE_SOURCE":
        result["delivery_action"] = "STALE_SOURCE_NOOP"
    elif change_state in ("NEWER", "MISSING_STORED"):
        result["delivery_action"] = "WOULD_UPDATE" if not apply else "UPDATED"
        if apply:
            _write_text(delivery_desc, build_delivery_description(item))
            client.update_issue(
                delivery_id,
                title=delivery_title(item),
                description_file=delivery_desc,
                priority=priority,
            )
            _set_tfs_metadata(client, delivery_id, item, ctx)
            full_delivery = client.get_issue(delivery_id)
    else:
        result["delivery_action"] = "NOOP"

    result["delivery_status"] = issue_status(full_delivery)
    return result


def reconcile_file(
    raw_file: Path,
    *,
    client: MulticaClient,
    ctx: RuntimeContext,
    run_dir: Path,
    apply: bool,
) -> dict:
    try:
        raw_data = json.loads(raw_file.read_text(encoding="utf-8"))
        return reconcile_one(
            raw_data,
            client=client,
            ctx=ctx,
            run_dir=run_dir,
            apply=apply,
        )
    except SyncError as exc:
        return {
            "tfs_id": raw_file.stem,
            "delivery_action": "ERROR",
            "creation_validation": {"result": "ERROR", "reasons": []},
            "activation_validation": {"result": "NOT_APPLICABLE", "reasons": []},
            "delivery_status": None,
            "errors": [exc.as_dict()],
            "retryable": is_retryable_multica_error(exc.code, exc.details),
            "apply": apply,
        }
    except Exception as exc:
        return {
            "tfs_id": raw_file.stem,
            "delivery_action": "ERROR",
            "creation_validation": {"result": "ERROR", "reasons": []},
            "activation_validation": {"result": "NOT_APPLICABLE", "reasons": []},
            "delivery_status": None,
            "errors": [{"code": "UNEXPECTED_ERROR", "message": str(exc)}],
            "retryable": False,
            "apply": apply,
        }
