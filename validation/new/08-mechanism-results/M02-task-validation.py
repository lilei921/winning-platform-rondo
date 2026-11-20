import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import uuid
import zipfile

sys.stdout.reconfigure(encoding="utf-8")

BASE = Path.cwd().resolve()
OUT = BASE / "validation-evidence"
EVIDENCE = OUT / "M02-autonomous-evidence.json"
PREVIOUS = OUT / "M02-autonomous-preflight-evidence.json"
ISSUE = "01a1d321-125e-715f-b0c7-7f7794478398"
THREAD = "01a1d324-59d9-7af8-a95a-48182756cf4d"
PORTABLE = Path(r"C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0")
GIT = PORTABLE / "cmd/git.exe"
SH = PORTABLE / "mingw64/bin/sh.exe"
BUSYBOX = PORTABLE / "mingw64/bin/busybox.exe"
SHELL_HASH = "ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32"
URL = "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo"
TRACE = OUT / "portable-git.trace"
TRACE2 = OUT / "portable-git-trace2.jsonl"
ORIGINAL_PATH = os.environ.get("PATH", "")
PORTABLE_ENV = dict(os.environ)
PORTABLE_ENV["PATH"] = str(GIT.parent) + os.pathsep + str(SH.parent) + os.pathsep + ORIGINAL_PATH


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def decode(raw):
    try:
        return raw.decode("utf-8"), "utf-8"
    except UnicodeDecodeError:
        return raw.decode("gb18030", errors="replace"), "gb18030"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def clean(value):
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(x) for x in value]
    if isinstance(value, str):
        for name, secret in os.environ.items():
            if re.search("TOKEN|PASSWORD|SECRET|API_KEY", name, re.I) and len(secret) >= 6:
                value = value.replace(secret, "[REDACTED]")
        value = re.sub(r"(https?://)[^/\s@]+@", r"\1[REDACTED]@", value)
    return value


if not PREVIOUS.exists():
    shutil.copyfile(EVIDENCE, PREVIOUS)
    old = json.loads(PREVIOUS.read_text(encoding="utf-8"))
    (OUT / "preflight-report.md").write_text(
        "初次 preflight：FAIL，后续 checkout/clone 未运行。\n\n"
        "默认 git/sh 均解析到 D:\\UserApp\\Git\\bin；未选中指定便携工具。"
        "实际 git 为 2.54.0.windows.1；sh --version 退出 3221225794（0xC0000142），"
        "stderr 包含 MSYS NtCreateDirectoryObject 权限错误 0xC0000022。\n\n"
        "指定 sh.exe 与 busybox.exe 已存在且 SHA256 均为 " + SHELL_HASH + "。"
        "这不是工具包安装失败。控制端补充说明 custom_env.PATH 被 daemon 的 isBlockedEnvKey 忽略；"
        "本 Runtime 未自行核验该控制端代码。\n\n"
        "有效配置：workspace-write / never / mxc。未执行 checkout、clone、commit，未创建 fixture。\n\n"
        "原始 JSON 已逐字节保留为 M02-autonomous-preflight-evidence.json；SHA256：" + sha(PREVIOUS) + "。\n"
        "后续依据用户修正采用显式兼容 Git 子进程调用，另记 M02-autonomous-evidence.json。\n",
        encoding="utf-8",
    )
    data = {
        "schema_version": 2, "issue_id": ISSUE, "guidance_thread_id": THREAD,
        "started_at": now(), "cwd": str(BASE), "identity": old["identity"],
        "expected": old["expected"], "effective_sandbox": old["effective_sandbox"],
        "initial_preflight": {"result": "FAIL", "path": str(PREVIOUS), "sha256": sha(PREVIOUS), "report": str(OUT / "preflight-report.md")},
        "default_tool_identity": old["tool_identity"],
        "compatibility_method": "Explicit portable Git subprocess; PATH prefix applies only to that subprocess tree. Default Task PATH is unchanged. Native Multica checkout uses original environment.",
        "controller_explanation": "Human reports daemon.go/isBlockedEnvKey ignores custom_env.PATH; not independently inspected in this Task.",
        "commands": [], "operations": [], "assertions": [], "snapshots": {}, "markers": [],
        "results": {"same_task_autonomous_clone": "NOT_RUN", "same_task_m02": "NOT_RUN", "cross_run": "pending controller follow-up", "rondo_dev_prepare": "NOT_RUN", "command_acceptance": "NOT_RUN", "real_business_authentication_and_push": "NOT_COVERED"},
    }
else:
    data = json.loads(EVIDENCE.read_text(encoding="utf-8"))


def save():
    EVIDENCE.write_text(json.dumps(clean(data), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class Halt(Exception):
    pass


def assert_that(name, success, actual=None, expected=None):
    data["assertions"].append({"name": name, "result": "PASS" if success else "FAIL", "actual": actual, "expected": expected, "time": now()})
    save()
    if not success:
        raise Halt(name)


def operation(label, fn):
    row = {"label": label, "cwd": str(BASE), "started_at": now()}
    try:
        result = fn()
        row.update(exit=0, result=clean(result))
        return result
    except Exception as exc:
        row.update(exit=1, error_category=type(exc).__name__, error=clean(str(exc)))
        raise
    finally:
        row["finished_at"] = now()
        data["operations"].append(row)
        save()


def run(argv, label, cwd=BASE, portable=False, trace=False):
    row = {"label": label, "started_at": now(), "cwd": str(cwd), "argv": [str(x) for x in argv],
           "environment": {"mode": "portable_git_subprocess_only" if portable else "original_task", "path_prefix": [str(GIT.parent), str(SH.parent)] if portable else [], "multica_variables_changed": False}}
    env = dict(PORTABLE_ENV) if portable else dict(os.environ)
    if trace:
        env["GIT_TRACE"] = TRACE.as_posix()
        env["GIT_TRACE2_EVENT"] = TRACE2.as_posix()
        row["environment"]["trace"] = str(TRACE)
        row["environment"]["trace2"] = str(TRACE2)
    print(json.dumps({"starting": label, "cwd": str(cwd)}), flush=True)
    try:
        proc = subprocess.run(row["argv"], cwd=cwd, env=env, capture_output=True)
        stdout, stdout_encoding = decode(proc.stdout)
        stderr, stderr_encoding = decode(proc.stderr)
        row.update(exit=proc.returncode, stdout=stdout, stderr=stderr, stdout_encoding=stdout_encoding, stderr_encoding=stderr_encoding, error_category=None if proc.returncode == 0 else "nonzero_exit")
    except OSError as exc:
        row.update(exit=None, stdout="", stderr=str(exc), error_category="process_start_error")
    row["finished_at"] = now()
    row = clean(row)
    data["commands"].append(row)
    save()
    print(json.dumps({"completed": label, "exit": row["exit"], "stdout": row["stdout"][:1500], "stderr": row["stderr"][:1500]}, ensure_ascii=False), flush=True)
    if row["exit"] != 0:
        raise Halt(label + " failed: " + str(row["exit"]))
    return row["stdout"].rstrip("\r\n")


def cli(args, label):
    cmd = '& "$env:MULTICA_CLI_PATH" ' + " ".join("'" + x.replace("'", "''") + "'" for x in args) + '; exit $LASTEXITCODE'
    return run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); " + cmd], label)


def git(args, label, cwd, trace=False):
    return run([GIT, "-C", str(cwd)] + list(args), label, cwd=cwd, portable=True, trace=trace)


def snapshot(path, label):
    snap = {"path": str(path.resolve())}
    for name, args in {
        "top_level": ["rev-parse", "--show-toplevel"], "head": ["rev-parse", "HEAD"],
        "branch": ["symbolic-ref", "--short", "HEAD"], "git_dir": ["rev-parse", "--absolute-git-dir"],
        "common_dir": ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        "origin": ["remote", "get-url", "origin"], "status": ["status", "--porcelain=v1", "--untracked-files=all"],
    }.items():
        snap[name] = git(args, label + "_" + name, path)
    snap["dot_git_is_directory"] = (path / ".git").is_dir()
    snap["git_dir_is_directory"] = Path(snap["git_dir"]).is_dir()
    data["snapshots"][label] = snap
    save()
    return snap


def phase_prepare():
    hashes = operation("portable_shell_hashes", lambda: {"sh": sha(SH), "busybox": sha(BUSYBOX), "git": sha(GIT)})
    data["portable_tool_hashes"] = hashes
    assert_that("portable_sh_hash", hashes["sh"] == SHELL_HASH, hashes["sh"], SHELL_HASH)
    assert_that("portable_busybox_hash", hashes["busybox"] == SHELL_HASH, hashes["busybox"], SHELL_HASH)
    data["portable_git_version"] = git(["--version"], "portable_git_version", BASE)
    run([SH, "-c", "exit 0"], "portable_sh_smoke", portable=True)
    data["portable_resolution"] = run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Command git,sh,git-upload-pack | Select-Object Name,Source | ConvertTo-Json"], "portable_subprocess_resolution", portable=True)
    values = data["effective_sandbox"]["selected_values"]
    assert_that("effective_sandbox_unchanged", values == {"sandbox_mode": "workspace-write", "approval_policy": "never", "windows.sandbox": "mxc"}, values)
    data["active_runs"] = json.loads(cli(["issue", "runs", ISSUE, "--active", "--output", "json"], "active_task_identity"))
    data["guidance"] = json.loads(cli(["issue", "comment", "list", ISSUE, "--thread", THREAD, "--tail", "30", "--compact", "--output", "json"], "read_authorized_guidance"))
    output = cli(["repo", "checkout", URL, "--ref", "main"], "native_root_checkout_first")
    data["native_checkout_output"] = output
    save()
    candidates = [p for p in BASE.iterdir() if p.is_dir() and (p / ".git").exists()]
    assert_that("one_native_root_in_task", len(candidates) == 1, [str(p) for p in candidates], "one root checkout")
    root = candidates[0].resolve()
    data["root_path"] = str(root)
    first = snapshot(root, "root_baseline")
    origin_main = git(["rev-parse", "origin/main"], "root_origin_main", root)
    data["root_origin_main"] = origin_main
    assert_that("root_head_matches_observed_main", first["head"] == origin_main, first["head"], origin_main)
    assert_that("root_origin", first["origin"] == URL, first["origin"], URL)
    data["gitignore"] = operation("read_root_gitignore", lambda: (root / ".gitignore").read_text(encoding="utf-8-sig"))
    data["repo_context_yaml"] = operation("read_repo_context", lambda: (root / "docs/config/repo-context.yaml").read_text(encoding="utf-8-sig"))
    data["results"]["native_root_checkout"] = "PASS"
    save()
    print(json.dumps({"root": str(root), "gitignore": data["gitignore"], "repo_context_yaml": data["repo_context_yaml"], "active_runs": data["active_runs"]}, ensure_ascii=False), flush=True)


def phase_clone():
    root = Path(data["root_path"])
    active = [x for x in data["active_runs"] if x["id"] == data["identity"]["task_id"]]
    assert_that("current_task_identity", len(active) == 1, len(active), 1)
    for field in ("runtime_id", "workspace_id", "agent_id"):
        assert_that("task_" + field, active[0][field] == data["expected"][field], active[0][field], data["expected"][field])
    assert_that("task_workdir", Path(active[0]["work_dir"]).resolve() == BASE, active[0]["work_dir"], str(BASE))
    old = json.loads(PREVIOUS.read_text(encoding="utf-8"))
    assert_that("daemon_id", old["daemon_status"]["daemon_id"] == data["expected"]["daemon_id"], old["daemon_status"]["daemon_id"], data["expected"]["daemon_id"])
    data["guidance_correctly_decoded"] = json.loads(cli(["issue", "comment", "list", ISSUE, "--thread", THREAD, "--tail", "30", "--compact", "--output", "json"], "guidance_encoding_checked"))
    # Parse only the common record; business repository URLs are never accessed.
    common_block = re.search(r"(?ms)^  - repo_id: common\s*\n(.*?)(?=^  - repo_id:|\Z)", data["repo_context_yaml"])
    assert_that("common_context_found", common_block is not None)
    common = {"repo_id": "common"}
    for key in ("repo_path", "repo_url"):
        match = re.search(r"(?m)^    " + key + r":\s*(.+)$", common_block.group(1))
        assert_that("common_" + key + "_present", match is not None)
        common[key] = match.group(1).strip().strip("\"'")
    data["common"] = common
    relative = Path(common["repo_path"])
    assert_that("common_is_direct_child", not relative.is_absolute() and len(relative.parts) == 1 and relative.name not in ("", ".", ".."), str(relative))
    child = root / relative
    assert_that("common_does_not_exist", not os.path.lexists(child), os.path.lexists(child), False)
    assert_that("root_has_no_reparse_point", not bool(getattr(root.lstat(), "st_file_attributes", 0) & 0x400))
    assert_that("common_resolves_under_root", child.resolve().parent == root.resolve(), str(child.resolve()))
    ignore = git(["check-ignore", "-v", "--", common["repo_path"] + "/"], "existing_ignore_rule", root)
    assert_that("existing_gitignore_matches_common", ignore.startswith(".gitignore:") and "/winning-dps-df-*/" in ignore, ignore)
    data["ignore_rule"] = ignore
    data["root_config_file_hashes_before"] = operation("root_context_hashes_before", lambda: {x: sha(root / x) for x in (".gitignore", "docs/config/repo-context.yaml")})
    fixture = BASE / "validation-fixture"
    seed = fixture / "seed"
    bare = fixture / "local-bare"
    assert_that("fixture_absent_before_creation", not fixture.exists())
    operation("create_fixture_directory", lambda: (fixture.mkdir(), str(fixture))[1])
    marker = "M02-" + data["identity"]["task_id"] + "-" + uuid.uuid4().hex
    data["unique_marker"] = marker
    data.update(seed_path=str(seed), bare_path=str(bare), child_path=str(child))
    git(["init", "--initial-branch=main", str(seed)], "seed_init", fixture)
    operation("write_unique_seed_readme", lambda: (seed / "README.txt").write_text(marker + "\n", encoding="utf-8"))
    git(["add", "--", "README.txt"], "seed_add_readme", seed)
    git(["-c", "user.name=M02 local validation", "-c", "user.email=m02-validation@example.invalid", "commit", "-m", "M02 isolated local fixture " + marker], "seed_single_commit", seed)
    seed_head = git(["rev-parse", "HEAD"], "seed_head", seed)
    assert_that("seed_single_commit", git(["rev-list", "--count", "HEAD"], "seed_commit_count", seed) == "1")
    data["seed_head"] = seed_head
    git(["clone", "--bare", str(seed), str(bare)], "clone_seed_to_local_bare", fixture, trace=True)
    bare_head = git(["rev-parse", "HEAD"], "bare_head", bare)
    data["bare_head"] = bare_head
    assert_that("bare_head_matches_seed", bare_head == seed_head, bare_head, seed_head)
    git(["clone", str(bare), str(child)], "clone_local_bare_to_child", root, trace=True)
    data["results"]["same_task_autonomous_clone"] = "PASS"
    child_snap = snapshot(child, "child_clean")
    root_snap = snapshot(root, "root_after_clone")
    assert_that("child_head_matches_seed", child_snap["head"] == seed_head, child_snap["head"], seed_head)
    assert_that("child_branch_main", child_snap["branch"] == "main", child_snap["branch"], "main")
    assert_that("child_origin_is_local_bare", Path(child_snap["origin"]).resolve() == bare.resolve(), child_snap["origin"], str(bare))
    assert_that("root_unchanged_after_clone", root_snap == data["snapshots"]["root_baseline"], root_snap, data["snapshots"]["root_baseline"])
    for label, snap, expected_path in (("root", root_snap, root), ("child", child_snap, child)):
        assert_that(label + "_own_toplevel", Path(snap["top_level"]).resolve() == expected_path.resolve())
        assert_that(label + "_own_dot_git_directory", snap["dot_git_is_directory"])
        assert_that(label + "_own_common_dir", Path(snap["common_dir"]).resolve() == (expected_path / ".git").resolve())
    assert_that("two_independent_git_metadata_dirs", root_snap["common_dir"] != child_snap["common_dir"])
    assert_that("root_does_not_track_child", git(["ls-files", "--", common["repo_path"]], "root_ls_files_child", root) == "")
    assert_that("child_not_reparse_point", not bool(getattr(child.lstat(), "st_file_attributes", 0) & 0x400))
    readme = child / "README.txt"
    untracked = child / ("M02-untracked-" + uuid.uuid4().hex + ".txt")
    data["readme_before_dirty_sha256"] = sha(readme)
    operation("append_child_tracked_change", lambda: readme.write_text(readme.read_text(encoding="utf-8") + "tracked-dirty " + marker + "\n", encoding="utf-8"))
    operation("write_child_untracked_marker", lambda: untracked.write_text("untracked " + marker + "\n", encoding="utf-8"))
    data["markers"] = [{"kind": kind, "path": str(p), "sha256": sha(p)} for kind, p in (("tracked_dirty", readme), ("untracked", untracked))]
    data["child_diff_before_reentry"] = git(["diff", "--", "README.txt"], "child_tracked_diff", child)
    dirty = snapshot(child, "child_dirty_before_reentry")
    assert_that("child_has_tracked_dirty_change", " M README.txt" in dirty["status"], dirty["status"])
    assert_that("child_has_untracked_marker", "?? " + untracked.name in dirty["status"], dirty["status"])
    before = snapshot(root, "root_before_reentry")
    assert_that("root_clean_after_child_dirty", before == data["snapshots"]["root_baseline"], before["status"], "")
    data["trace_files"] = [{"path": str(p), "sha256": sha(p)} for p in (TRACE, TRACE2)]
    save()
    print(json.dumps({"seed_head": seed_head, "bare_head": bare_head, "child_head": child_snap["head"], "markers": data["markers"], "trace": TRACE.read_text(encoding="utf-8", errors="replace")}, ensure_ascii=False), flush=True)


def phase_reentry():
    root = Path(data["root_path"])
    child = Path(data["child_path"])
    cli(["repo", "checkout", URL], "native_root_checkout_reentry")
    root_after = snapshot(root, "root_after_reentry")
    child_after = snapshot(child, "child_after_reentry")
    assert_that("root_snapshot_preserved_on_reentry", root_after == data["snapshots"]["root_before_reentry"], root_after, data["snapshots"]["root_before_reentry"])
    assert_that("child_snapshot_preserved_on_reentry", child_after == data["snapshots"]["child_dirty_before_reentry"], child_after, data["snapshots"]["child_dirty_before_reentry"])
    for marker in data["markers"]:
        current = sha(marker["path"])
        assert_that("preserved_" + marker["kind"] + "_sha256", current == marker["sha256"], current, marker["sha256"])
        marker["after_reentry_sha256"] = current
    after_diff = git(["diff", "--", "README.txt"], "child_diff_after_reentry", child)
    assert_that("child_diff_preserved", after_diff == data["child_diff_before_reentry"])
    assert_that("root_still_does_not_track_child", git(["ls-files", "--", data["common"]["repo_path"]], "root_ls_files_child_after_reentry", root) == "")
    after_hashes = operation("root_context_hashes_after", lambda: {x: sha(root / x) for x in (".gitignore", "docs/config/repo-context.yaml")})
    assert_that("root_ignore_and_context_unmodified", after_hashes == data["root_config_file_hashes_before"], after_hashes, data["root_config_file_hashes_before"])
    data["root_origin_main_after_reentry"] = git(["rev-parse", "origin/main"], "root_origin_main_after_reentry", root)
    assert_that("process_path_unmodified", os.environ.get("PATH", "") == ORIGINAL_PATH)
    data["default_resolution_after"] = run(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-Command git,sh | Select-Object Name,Source | ConvertTo-Json"], "default_resolution_after_reentry")
    save()


def phase_verify():
    assert_that("original_preflight_preserved", sha(PREVIOUS) == data["initial_preflight"]["sha256"], sha(PREVIOUS), data["initial_preflight"]["sha256"])
    text = operation("read_local_clone_trace", lambda: TRACE.read_text(encoding="utf-8"))
    shell_lines = [line for line in text.splitlines() if "start_command: " + SH.as_posix() + " -c " in line]
    upload_lines = [line for line in text.splitlines() if "trace: built-in: git upload-pack " in line]
    assert_that("trace_has_two_portable_sh_launches", len(shell_lines) == 2, len(shell_lines), 2)
    assert_that("trace_has_two_upload_pack_executions", len(upload_lines) == 2, len(upload_lines), 2)
    assert_that("trace_only_local_clone_paths", not re.search(r"https?://|ssh://", text))
    data["trace_proof"] = {"portable_sh_lines": shell_lines, "upload_pack_lines": upload_lines,
                           "upload_pack_executable_directory": str(SH.parent), "trace_sha256": sha(TRACE), "trace2_sha256": sha(TRACE2)}
    for label in ("clone_seed_to_local_bare", "clone_local_bare_to_child", "portable_sh_smoke", "native_root_checkout_first", "native_root_checkout_reentry"):
        rows = [x for x in data["commands"] if x["label"] == label]
        assert_that(label + "_exactly_once_exit_zero", len(rows) == 1 and rows[0]["exit"] == 0, [x["exit"] for x in rows], [0])
    native_rows = [x for x in data["commands"] if x["label"].startswith("native_root_checkout")]
    assert_that("native_checkout_original_environment", all(x["environment"]["mode"] == "original_task" and not x["environment"]["path_prefix"] for x in native_rows))
    assert_that("native_reentry_reported_kept", "Kept the existing checkout" in native_rows[-1]["stderr"])
    defaults = json.loads(data["default_resolution_after"])
    assert_that("default_tool_paths_unchanged", defaults == data["default_tool_identity"]["get_command"], defaults, data["default_tool_identity"]["get_command"])
    def read_sandbox():
        path = Path(os.environ["CODEX_HOME"]) / "config.toml"
        result = {"sandbox_mode": None, "approval_policy": None, "windows.sandbox": None}
        section = ""
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            heading = re.fullmatch(r"\[([^\]]+)\]", line)
            if heading:
                section = heading.group(1)
                continue
            match = re.match(r'(sandbox_mode|approval_policy|sandbox)\s*=\s*[\"\x27]([^\"\x27]*)[\"\x27]', line)
            if match:
                key = match.group(1)
                if not section and key in ("sandbox_mode", "approval_policy"):
                    result[key] = match.group(2)
                elif section == "windows" and key == "sandbox":
                    result["windows.sandbox"] = match.group(2)
        return result
    final_sandbox = operation("effective_sandbox_final_allowlisted_read", read_sandbox)
    data["effective_sandbox"]["final_selected_values"] = final_sandbox
    assert_that("sandbox_retained_workspace_write_never_mxc", final_sandbox == {"sandbox_mode": "workspace-write", "approval_policy": "never", "windows.sandbox": "mxc"}, final_sandbox)
    issue = json.loads(cli(["issue", "get", ISSUE, "--output", "json"], "final_issue_status_read_only"))
    data["issue_status"] = {"observed": issue["status"], "mutated": False, "reason": "Issue explicitly prohibits Issue Metadata modification"}
    assert_that("controlled_commands_all_exit_zero", all(x["exit"] == 0 for x in data["commands"]))
    assert_that("controlled_assertions_all_pass", all(x["result"] == "PASS" for x in data["assertions"]))
    data["results"].update(same_task_autonomous_clone="PASS", same_task_m02="PASS", overall="PARTIAL: same-Task PASS; cross-Run pending controller follow-up")
    data["finished_at"] = now()
    save()


def write_reports_and_bundle():
    report = OUT / "M02-autonomous-report.md"
    root = data["snapshots"]["root_after_reentry"]
    child = data["snapshots"]["child_after_reentry"]
    tracked, untracked = data["markers"]
    report.write_text(
        "同 Task 自主 clone：PASS；M02 同 Task：PASS。跨 Run：pending controller follow-up，尚不作总体 PASS。\n\n"
        "本次采用用户补充授权的“显式兼容 Git 子进程调用”：绝对路径执行便携 Git，仅对子进程树前置 cmd / mingw64\\bin。"
        "默认 Git/sh 仍为 D:\\UserApp\\Git\\bin，并未修复默认 PATH；原生根仓 checkout 始终使用注入的真实 CLI 与原 Task 环境。"
        "有效沙箱前后均为 workspace-write / never / mxc。\n\n"
        "初次 preflight FAIL 原始证据已逐字节保留。便携 sh.exe/busybox.exe 安装 Hash 均正确，失败是默认解析未选中工具，并非安装失败。"
        "控制端说明 custom_env.PATH 被 daemon.go/isBlockedEnvKey 忽略；本次未自行审计该代码。"
        "原默认 sh --version 退出 3221225794（0xC0000142），stderr 的 MSYS 权限错误为 0xC0000022。\n\n"
        "修正后 sh.exe -c 'exit 0'、两次普通本地 clone、两次原生 checkout 均退出 0。"
        "portable-git.trace 两次记录便携 mingw64/bin/sh.exe -c 启动 git-upload-pack，随后同目录执行 git upload-pack；trace 仅含本地源路径。"
        "seed 使用命令级身份且仅提交一次，seed/bare/child SHA 一致。\n\n"
        "common 从 docs/config/repo-context.yaml 读取，真实业务 URL 仅记录，未访问。目标创建前不存在、是根仓直接子目录；"
        "创建前后无 reparse point。既有 .gitignore 第 8 行 /winning-dps-df-*/ 命中，配置文件 Hash 前后一致。"
        "双仓均有独立 .git 目录和 common-dir。根仓重入明确返回 KEPT；两仓路径、HEAD、分支、origin、.git/common-dir、status 和 child diff 均保持，"
        "两个 marker 的 SHA256 均保持。root status 为空，ls-files 不包含 child。\n\n"
        f"Task：`{data['identity']['task_id']}`；Runtime：`{data['expected']['runtime_id']}`；Daemon：`{data['expected']['daemon_id']}`。\n\n"
        f"- root：`{data['root_path']}`\n"
        f"- child：`{data['child_path']}`\n"
        f"- seed：`{data['seed_path']}`\n"
        f"- bare：`{data['bare_path']}`\n"
        f"- evidence：`{EVIDENCE}`\n\n"
        f"root HEAD / origin/main：`{root['head']}`；branch：`{root['branch']}`。\n\n"
        f"seed / bare / child HEAD：`{data['seed_head']}`；child branch：`{child['branch']}`；origin 指向上述 local-bare。\n\n"
        f"- tracked marker：`{tracked['path']}`；SHA256：`{tracked['sha256']}`。\n"
        f"- untracked marker：`{untracked['path']}`；SHA256：`{untracked['sha256']}`。\n"
        f"- sh.exe / busybox.exe SHA256：`{SHELL_HASH}`。\n"
        f"- preflight JSON SHA256：`{sha(PREVIOUS)}`。\n"
        f"- final JSON SHA256：`{sha(EVIDENCE)}`。\n"
        f"- GIT_TRACE SHA256：`{sha(TRACE)}`。\n\n"
        f"受控阶段记录 {len(data['commands'])} 条命令及 {len(data['assertions'])} 项断言，均通过；原失败单独留档。"
        "全部 fixture 与 child 脏修改保留供下一独立 Run 只读复核。Rondo dev prepare 未执行，命令验收 NOT_RUN；真实业务认证/Push 未覆盖。"
        "未修改 Issue 状态或其他 metadata；未执行生产 Push/PR/Work Item 操作。\n",
        encoding="utf-8",
    )
    artifacts = [EVIDENCE, report, PREVIOUS, OUT / "preflight-report.md", TRACE, TRACE2, OUT / "collect_m02_preflight.py", Path(__file__).resolve()]
    # Inspect every text artifact against injected secret values without printing them.
    for path in artifacts:
        content = path.read_text(encoding="utf-8")
        for name, secret in os.environ.items():
            if re.search("TOKEN|PASSWORD|SECRET|API_KEY", name, re.I) and len(secret) >= 6 and secret in content:
                raise Halt("Secret scan failed for " + path.name)
    manifest = OUT / "SHA256SUMS.txt"
    manifest.write_text("".join(sha(path) + "  " + path.name + "\n" for path in artifacts), encoding="utf-8")
    bundle = OUT / "M02-autonomous-evidence-bundle.zip"
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in artifacts + [manifest]:
            archive.write(path, path.name)
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None:
            raise Halt("Bundle CRC validation failed")
        for path in artifacts:
            if hashlib.sha256(archive.read(path.name)).hexdigest() != sha(path):
                raise Halt("Bundle hash mismatch: " + path.name)
    print(json.dumps({"results": data["results"], "commands": len(data["commands"]), "assertions": len(data["assertions"]), "evidence_sha256": sha(EVIDENCE), "report_sha256": sha(report), "bundle_sha256": sha(bundle), "preflight_sha256": sha(PREVIOUS), "trace_sha256": sha(TRACE), "root": root, "child": child, "markers": data["markers"]}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    try:
        phase = sys.argv[1]
        if phase == "prepare":
            phase_prepare()
        elif phase == "clone":
            phase_clone()
        elif phase == "reentry":
            phase_reentry()
        elif phase == "verify":
            phase_verify()
        else:
            raise ValueError("Unknown phase: " + phase)
        data["last_completed_phase"] = phase
        data["updated_at"] = now()
        save()
        if phase == "verify":
            write_reports_and_bundle()
    except Exception as exc:
        data["failure"] = {"time": now(), "type": type(exc).__name__, "message": str(exc), "state_preserved": True}
        save()
        print(json.dumps(data["failure"], ensure_ascii=False), flush=True)
        sys.exit(1)
