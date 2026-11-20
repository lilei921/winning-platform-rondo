#!/usr/bin/env python3
"""Disable runtime-inherited skills for selected Multica agents.

Python 3.7+; no third-party dependencies. Works on macOS, Linux and Windows.
Dry-run by default. --apply is required to persist changes.

Normally invoked through ../sync_workspace.py; can also be run directly:
  python3 disable_runtime_skills.py
  python3 disable_runtime_skills.py --apply
  python3 disable_runtime_skills.py --profile staging --apply
  python3 disable_runtime_skills.py --agent-id UUID --apply

By default, credentials, server URL, and workspace ID are read from the local
Multica CLI profile (~/.multica/config.json). Explicit flags and environment
variables override the profile; token input is requested only if none is found.
The script never changes agent-associated workspace skills or runtime files.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

DEFAULT_SERVER = "https://api.multica.ai"
VALID_ROOTS = {"provider", "universal", "plugin"}
SUPPORTED_PROVIDERS = {"claude", "codex"}


class ApiError(Exception):
    """A Multica API call failed."""


class RuntimeGoneError(ApiError):
    """The agent's runtime no longer exists in this workspace.

    Runtime is workspace-scoped and disappears when the daemon that registered it
    is removed or re-registered. The agent keeps the stale binding, so there is
    nothing to disable; the binding has to be re-pointed instead.
    """


class MulticaClient:
    def __init__(self, base_url: str, token: str, workspace_id: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers = {
            "Authorization": f"Bearer {token}",
            "X-Workspace-ID": workspace_id,
            "Accept": "application/json",
        }

    def request(self, method: str, path: str, data: dict[str, Any] | None = None) -> Any:
        body = json.dumps(data).encode("utf-8") if data is not None else None
        headers = self.headers.copy()
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers=headers,
            method=method,
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
        except urllib.error.HTTPError as exc:
            detail = exc.read(800).decode("utf-8", "replace")
            raise ApiError(f"HTTP {exc.code} ({method} {path}): {detail}") from exc
        except urllib.error.URLError as exc:
            raise ApiError(f"Connection failed ({method} {path}): {exc.reason}") from exc
        if not raw:
            return None  # 204 No Content from the disable API.
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ApiError(f"Invalid JSON returned from {method} {path}") from exc

    def list_agents(self, workspace_id: str) -> list[dict[str, Any]]:
        query = urllib.parse.urlencode({"workspace_id": workspace_id})
        result = self.request("GET", f"/api/agents?{query}")
        if not isinstance(result, list):
            raise ApiError("GET /api/agents did not return a list")
        return result

    def get_agent(self, agent_id: str) -> dict[str, Any]:
        result = self.request("GET", f"/api/agents/{urllib.parse.quote(agent_id, safe='')}")
        if not isinstance(result, dict):
            raise ApiError(f"Invalid response for agent {agent_id}")
        return result

    def discover_runtime_skills(self, runtime_id: str, timeout: float) -> list[dict[str, Any]]:
        prefix = f"/api/runtimes/{urllib.parse.quote(runtime_id, safe='')}/local-skills"
        try:
            result = self.request("POST", prefix)
        except ApiError as exc:
            # runtime 已从该 workspace 消失（daemon 注销或重注册）：Agent 保留了失效绑定，
            # 没有可禁用的 Skill，需要改绑而不是重试。
            if "runtime not found" in str(exc):
                raise RuntimeGoneError(str(exc)) from exc
            raise
        if not isinstance(result, dict) or not result.get("id"):
            raise ApiError(f"Runtime {runtime_id}: discovery did not return a request ID")
        request_id = urllib.parse.quote(str(result["id"]), safe="")
        started = time.monotonic()
        while result.get("status") in ("pending", "running"):
            if time.monotonic() - started >= timeout:
                raise ApiError(f"Runtime {runtime_id}: discovery timed out after {timeout:g}s")
            time.sleep(0.5)
            result = self.request("GET", f"{prefix}/{request_id}")
            if not isinstance(result, dict):
                raise ApiError(f"Runtime {runtime_id}: invalid discovery status response")
        if result.get("status") != "completed":
            raise ApiError(
                f"Runtime {runtime_id}: discovery {result.get('status')} "
                f"({result.get('error', 'unknown error')})"
            )
        if result.get("supported") is not True:
            raise ApiError(f"Runtime {runtime_id}: skill discovery unsupported")
        skills = result.get("skills") or []
        if not isinstance(skills, list):
            raise ApiError(f"Runtime {runtime_id}: invalid skills response")
        return skills

    def disable_skill(self, agent_id: str, runtime_id: str, skill: dict[str, Any]) -> None:
        payload = {
            "runtime_id": runtime_id,
            "root": skill["root"],
            "key": skill["key"],
            "name": skill.get("name") or "",
            "plugin": skill.get("plugin") or "",
            "enabled": False,
        }
        path = f"/api/agents/{urllib.parse.quote(agent_id, safe='')}/runtime-skills/enabled"
        self.request("PUT", path, payload)


def identity(runtime_id: str, skill: dict[str, Any]) -> tuple[str, str, str, str, str]:
    return (
        runtime_id,
        str(skill.get("provider") or ""),
        str(skill.get("root") or ""),
        str(skill.get("key") or ""),
        str(skill.get("plugin") or ""),
    )


def eligible_skill(skill: Any) -> bool:
    if not isinstance(skill, dict):
        return False
    if skill.get("can_disable") is not True:
        return False
    if skill.get("provider") not in SUPPORTED_PROVIDERS:
        return False
    if skill.get("root") not in VALID_ROOTS:
        return False
    if not isinstance(skill.get("key"), str) or not skill["key"].strip():
        return False
    if skill["root"] == "plugin" and (
        skill.get("provider") != "claude" or not skill.get("plugin")
    ):
        return False
    return True


def already_disabled(agent: dict[str, Any], skill: dict[str, Any]) -> bool:
    existing = agent.get("disabled_runtime_skills") or []
    if not isinstance(existing, list):
        raise ApiError(f"Agent {agent.get('id')}: invalid disabled_runtime_skills")
    return any(
        isinstance(item, dict) and identity(str(agent["runtime_id"]), skill)
        == identity(str(item.get("runtime_id") or ""), item)
        for item in existing
    )


def load_cli_profile(profile: str) -> dict[str, Any]:
    """Reuse the configuration saved by `multica login` for this OS user."""
    if profile in (".", "..") or "/" in profile or "\\" in profile:
        raise ValueError("--profile must be a simple name, not a path")

    root = Path.home() / ".multica"
    path = root / "config.json" if not profile else root / "profiles" / profile / "config.json"
    try:
        with path.open("r", encoding="utf-8") as handle:
            config = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read Multica CLI profile ({path}): {exc}") from exc
    if not isinstance(config, dict):
        raise ValueError(f"Invalid Multica CLI profile ({path}): expected JSON object")
    return config


def resolve_configuration(args: argparse.Namespace) -> tuple[str, str, str]:
    """CLI precedence: flags > env > saved profile; secrets are never printed."""
    # Multica CLI intentionally prevents managed Agent tasks from borrowing
    # the human user's PAT. Keep that security boundary in this script.
    managed = any(os.environ.get(key) for key in (
        "MULTICA_AGENT_ID", "MULTICA_TASK_ID", "MULTICA_DAEMON_PORT",
        "MULTICA_TASK_CONFIG_ROOT",
    ))
    if managed:
        raise ValueError(
            "Detected a daemon-managed environment. Run this maintenance script "
            "from a normal local shell, not inside an Agent task."
        )

    config = load_cli_profile(args.profile)
    server_url = (args.server_url or os.getenv("MULTICA_SERVER_URL")
                  or config.get("server_url") or DEFAULT_SERVER)
    workspace_id = (args.workspace_id or os.getenv("MULTICA_WORKSPACE_ID")
                    or config.get("workspace_id"))
    token = os.getenv("MULTICA_TOKEN") or config.get("token")
    if not workspace_id or not isinstance(workspace_id, str):
        raise ValueError(
            "Workspace not configured. Run `multica workspace switch <id>` "
            "or specify --workspace-id."
        )
    if not isinstance(server_url, str) or not server_url.startswith(("http://", "https://")):
        raise ValueError("--server-url must start with http:// or https://")
    if not isinstance(token, str) or not token.strip():
        token = getpass.getpass("No CLI token found; enter Multica PAT: ")
    if not token.strip():
        raise ValueError("No CLI login found. Run `multica login` or provide MULTICA_TOKEN.")
    if not token.strip().startswith("mul_"):
        raise ValueError("A user PAT (mul_...) is required; task tokens cannot manage Agent skills.")
    return server_url.rstrip("/"), workspace_id, token.strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--profile", default="", metavar="NAME", help="Multica CLI profile (default: ~/.multica/config.json)")
    parser.add_argument("--workspace-id", help="Workspace UUID (overrides CLI profile / MULTICA_WORKSPACE_ID)")
    parser.add_argument("--server-url", help="Multica API URL (overrides CLI profile / MULTICA_SERVER_URL)")
    parser.add_argument("--agent-id", action="append", dest="agent_ids", default=[], metavar="UUID", help="Only this Agent; repeat to select several")
    parser.add_argument("--apply", action="store_true", help="Actually disable skills (default: preview only)")
    parser.add_argument("--discovery-timeout", type=float, default=60, metavar="SECONDS", help="Runtime skill discovery timeout, default 60s")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.discovery_timeout <= 0:
        print("ERROR: --discovery-timeout must be positive", file=sys.stderr)
        return 2
    try:
        server_url, workspace_id, token = resolve_configuration(args)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    client = MulticaClient(server_url, token, workspace_id)
    requested_ids = set(args.agent_ids)
    failures = 0
    changed = 0
    planned = 0
    skipped = 0
    runtime_cache: dict[str, list[dict[str, Any]]] = {}
    runtime_failures: dict[str, str] = {}
    runtime_gone: dict[str, str] = {}
    print(f"Mode: {'APPLY' if args.apply else 'DRY RUN'} | workspace: {workspace_id}", flush=True)
    try:
        agent_summaries = client.list_agents(workspace_id)
    except ApiError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    selected = [
        a for a in agent_summaries
        if isinstance(a, dict)
        and a.get("id")
        and a.get("runtime_id")
        and not a.get("archived_at")
        and a.get("kind", "user") == "user"
        and (not requested_ids or a["id"] in requested_ids)
    ]
    found_ids = {a["id"] for a in selected}
    unknown_ids = requested_ids - found_ids
    for agent_id in sorted(unknown_ids):
        print(f"[WARN] Selected agent not found, archived, or has no runtime: {agent_id}", file=sys.stderr)
        failures += 1

    print(f"Selected agents: {len(selected)}")
    for summary in selected:
        agent_id = summary["id"]
        try:
            agent = client.get_agent(agent_id)
            runtime_id = agent.get("runtime_id")
            if not runtime_id:
                print(f"[SKIP] {agent.get('name', agent_id)}: runtime is unbound")
                skipped += 1
                continue

            if runtime_id in runtime_gone:
                print(
                    f"[SKIP] {agent.get('name', agent_id)}: runtime {runtime_id} 已不在该 workspace，"
                    "Agent 绑定失效，需改绑 runtime 后重跑",
                )
                skipped += 1
                continue

            if runtime_id in runtime_failures:
                print(f"[SKIP] {agent.get('name', agent_id)}: {runtime_failures[runtime_id]}")
                failures += 1
                continue

            if runtime_id not in runtime_cache:
                try:
                    runtime_cache[runtime_id] = [
                        s for s in client.discover_runtime_skills(runtime_id, args.discovery_timeout)
                        if eligible_skill(s)
                    ]
                except RuntimeGoneError as exc:
                    runtime_gone[runtime_id] = str(exc)
                    print(
                        f"[SKIP] {agent.get('name', agent_id)}: runtime {runtime_id} 已不在该 workspace，"
                        "Agent 绑定失效，需改绑 runtime 后重跑",
                    )
                    skipped += 1
                    continue
                except ApiError as exc:
                    runtime_failures[runtime_id] = str(exc)
                    raise

            skills = runtime_cache[runtime_id]
            pending = [s for s in skills if not already_disabled(agent, s)]
            print(
                f"\nAgent: {agent.get('name', agent_id)} [{agent_id}]\n"
                f"  Runtime: {runtime_id} | discovered: {len(skills)} | to disable: {len(pending)}"
            )
            for skill in pending:
                label = f"{skill.get('name') or skill['key']} ({skill['root']}:{skill['key']})"
                planned += 1
                if not args.apply:
                    print(f"  [PREVIEW] disable {label}")
                    continue
                try:
                    client.disable_skill(agent_id, runtime_id, skill)
                    changed += 1
                    print(f"  [OK] disabled {label}")
                except ApiError as exc:
                    failures += 1
                    print(f"  [FAIL] {label}: {exc}", file=sys.stderr)
        except ApiError as exc:
            failures += 1
            print(f"[FAIL] Agent {summary.get('name', agent_id)} [{agent_id}]: {exc}", file=sys.stderr)

    print(f"\nSummary: planned={planned}, changed={changed}, skipped_agents={skipped}, failures={failures}")
    if not args.apply:
        print("Dry-run only. Add --apply to save these changes.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())