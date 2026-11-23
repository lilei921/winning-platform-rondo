/**
 * finalize 契约绑定 + 顺序修正 + 白名单收窄（rll5-replay-remediation-plan M2.2–M2.5/F2）。
 *
 * fixture：bare 根仓 remote + 根仓（含 openspec/changes/<ref>/）+ 业务仓 bare remote + 枢纽克隆
 * （rootRepo/repo1，.gitignore 排除）；TFS 由进程内 node:http stub 充当（TFS_SERVER_URL 指向），
 * multica 由 mock-multica.cjs 充当；openspec 由临时 bin 目录的桩（复制 specs delta + 移动目录）充当。
 *
 * 注意：CLI 必须异步 spawn——TFS stub 在本进程内，spawnSync 会冻结事件循环导致超时。
 *
 * 验收点：
 *  T1 happy finalize：PASS；steps 键序对 golden 一致；OPS_LOG 证明 archive < tfs 回写 < summary 评论；
 *     归档发生且 push 到达；contract_files 以未勾选 tasks.md 计算（勾选变化不改哈希仍 PASS）；
 *  T2 gate 三态：旧 hash → exit 2；缺 contract_files → exit 3；无适用 Evidence → exit 3；
 *  T3 M2.3：Change 工件未提交 → 先 "finalize:" 提交再归档；foreign 预暂存 → exit 3 且不提交；
 *  T4 M2.5：未涉及 capability 的 specs 脏文件 → exit 3；涉及 capability 的 → 随归档提交；
 *  T5 续走：完整跑一遍后重跑 → done-shortcut；预置"已归档+writeback 完成+无 summary_comment_id"
 *     → summary 恰好发一次。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, realpathSync, rmSync, appendFileSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const { computeContractFiles } = await import(pathToFileURL(fileURLToPath(new URL("../dist/commands/delivery/contract-files.js", import.meta.url))).href);

const CHANGE_REF = "c-fin";
const STEPS_GOLDEN = ["pr_transition_gate", "pending_written", "workspace_reconciliation", "completion_gate",
  "summary", "route_archive", "tfs_writeback", "issue_done", "pending_cleared"];

function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** 假 openspec：archive = 复制 specs delta 到 openspec/specs/ + 移动 change 目录到 archive/2026-01-01-<ref>。 */
const FAKE_OPENSPEC_JS = String.raw`
const fs = require("fs"), path = require("path");
const a = process.argv.slice(2);
if (a[0] === "archive") {
  const ref = a[1], root = process.cwd();
  const src = path.join(root, "openspec", "changes", ref);
  if (!fs.existsSync(src)) { console.error("change not found: " + ref); process.exit(1); }
  const specsDir = path.join(src, "specs");
  if (fs.existsSync(specsDir)) {
    for (const cap of fs.readdirSync(specsDir)) {
      const s = path.join(specsDir, cap);
      if (fs.statSync(s).isDirectory()) fs.cpSync(s, path.join(root, "openspec", "specs", cap), { recursive: true });
    }
  }
  const dst = path.join(root, "openspec", "changes", "archive", "2026-01-01-" + ref);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  if (process.env.OPS_LOG) fs.appendFileSync(process.env.OPS_LOG, "archive\n");
  // 模拟归档期间其他工具暂存文件或远端推进，验证提交前检查与推送恢复。
  if (process.env.ARCHIVE_TEST_HOOK && fs.existsSync(process.env.ARCHIVE_TEST_HOOK)) require(process.env.ARCHIVE_TEST_HOOK);
  process.stdout.write("{}");
} else { console.error("unsupported"); process.exit(1); }
`;

/** TFS stub：pr get / repository get / workitem get / workitem PATCH（状态机内存态 + OPS_LOG）。
 * 注意：stub 跑在本测试进程内，拿不到子进程的 OPS_LOG env——由调用方以参数传入。
 * azure-devops-node-api 有 location 协商（OPTIONS /_apis/<area> → routeTemplate），
 * 须回放 location 表；GET /_apis/resourceAreas 回 on-prem 形状 {count:0,value:null}（SDK 回落 serverUrl）。 */
const TFS_LOCATIONS = [
  { id: "e81700f7-3be2-46de-8624-2eb35882fcaa", area: "Location", resourceName: "resourceAreas", routeTemplate: "_apis/resourceAreas", resourceVersion: 1, minVersion: "1.0", maxVersion: "4.1", releasedVersion: "4.1" },
  { id: "225f7195-f9c7-4d14-ab28-a83f7ff77e1f", area: "git", resourceName: "repositories", routeTemplate: "{project}/_apis/git/repositories/{repositoryId}", resourceVersion: 1, minVersion: "1.0", maxVersion: "4.1", releasedVersion: "4.1" },
  { id: "9946fd70-0d40-406e-b686-b4744cbbcc37", area: "git", resourceName: "pullRequests", routeTemplate: "{project}/_apis/git/repositories/{repositoryId}/pullrequests/{pullRequestId}", resourceVersion: 1, minVersion: "1.0", maxVersion: "4.1", releasedVersion: "4.1" },
  { id: "72c7ddf8-2cdc-4f60-90cd-ab71c14a399b", area: "wit", resourceName: "workItems", routeTemplate: "_apis/wit/workitems/{id}", resourceVersion: 2, minVersion: "1.0", maxVersion: "4.1", releasedVersion: "4.1" },
  { id: "1a9c53f7-f243-4447-b110-35ef023636e4", area: "wit", resourceName: "wiql", routeTemplate: "{project}/_apis/wit/wiql", resourceVersion: 2, minVersion: "1.0", maxVersion: "4.1", releasedVersion: "4.1" },
];

function startTfsStub(wiState, opsLog, control = { denyStateWrite: false }, gitRoot) {
  const wis = new Map([[999, {
    id: 999, rev: 1,
    fields: { "System.State": wiState, "System.WorkItemType": "Bug", "System.Title": "bug-999" },
    relations: [],
  }]]);
  // TFS 2018 updates 保留每一 revision 的增量，供跨调用评论去重回读。
  const updates = new Map([[999, [{ id: 1, workItemId: 999, rev: 1, fields: {} }]]]);
  const srv = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const p = gitRoot ? url.pathname.replace(/^\/tfs\/Test(?=\/)/, "") : url.pathname;
    // Git 的 HTTP 只读 fixture，共用 TFS stub 的地址，保留真实的认证和 Fetch 调用路径。
    const gitFile = p.match(/^\/Proj1\/_git\/root\/(HEAD|info\/refs|objects\/(?:info\/packs|[0-9a-f]{2}\/[0-9a-f]{38}))$/);
    if (gitRoot && req.method === "GET" && gitFile) {
      const file = join(gitRoot, gitFile[1]);
      if (!existsSync(file)) return res.writeHead(404).end();
      return res.writeHead(200).end(readFileSync(file));
    }
    const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "OPTIONS" && /^\/_apis\/[^/]+$/.test(p)) return json(200, { value: TFS_LOCATIONS });
    if (req.method === "GET" && p === "/_apis/resourceAreas") return json(200, { count: 0, value: null });
    if (req.method === "GET" && /\/_apis\/git\/repositories\/[^/]+\/pullrequests\/\d+$/.test(p)) {
      return json(200, {
        pullRequestId: 1, title: "t", status: 3,
        sourceRefName: "refs/heads/feat-1", targetRefName: "refs/heads/main",
        lastMergeCommit: { commitId: "deadbeef" }, createdBy: { displayName: "t" }, creationDate: "2026-01-01T00:00:00Z",
      });
    }
    if (req.method === "GET" && /\/_apis\/git\/repositories\/[^/]+$/.test(p)) {
      return json(200, { id: "repo-guid-1", name: "repo1", project: { id: "proj-guid" } });
    }
    if (req.method === "POST" && /\/_apis\/wit\/wiql$/.test(p)) {
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        const query = JSON.parse(body).query ?? "";
        const matches = [...wis.values()].filter(wi => {
          const equals = query.match(/\[System.Id\]\s*=\s*(\d+)/i);
          const contains = query.match(/\[System.Id\]\s+IN\s*\(([^)]+)\)/i);
          return equals ? wi.id === Number(equals[1]) : contains ? contains[1].split(",").map(Number).includes(wi.id) : false;
        });
        json(200, { queryType: "flat", workItems: matches.map(wi => ({ id: wi.id, url: `http://x/_apis/wit/workitems/${wi.id}` })) });
      });
      return;
    }
    if (req.method === "GET" && /\/_apis\/wit\/workitems$/.test(p) && url.searchParams.has("ids")) {
      const ids = url.searchParams.get("ids").split(",").map(Number);
      return json(200, { count: ids.length, value: ids.map(id => wis.get(id)).filter(Boolean) });
    }
    const updateMatch = p.match(/\/_apis\/wit\/workitems\/(\d+)\/updates$/);
    if (updateMatch && req.method === "GET") {
      const all = updates.get(Number(updateMatch[1])) ?? [];
      const skip = Number(url.searchParams.get('$skip') ?? 0), top = Number(url.searchParams.get('$top') ?? 200);
      const value = all.slice(skip, skip + top);
      return json(200, { count: value.length, value });
    }
    const wiMatch = p.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (wiMatch && req.method === "GET") {
      const wi = wis.get(Number(wiMatch[1]));
      return wi ? json(200, wi) : json(404, { message: "not found" });
    }
    if (wiMatch && req.method === "PATCH") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const wi = wis.get(Number(wiMatch[1]));
        if (!wi) return json(404, { message: "not found" });
        const ops = JSON.parse(body);
        if (control.denyStateWrite && ops.some(op => op.path === "/fields/System.State")) {
          return json(403, { message: "injected TFS state write failure" });
        }
        for (const op of ops) {
          if (op.path?.startsWith("/fields/")) {
            const f = op.path.slice("/fields/".length);
            wi.fields[f] = op.value;
            if (f === "System.State") appendFileSync(opsLog, "tfs-state\n");
            if (f === "System.History") appendFileSync(opsLog, "tfs-comment\n");
          } else if (op.path === "/relations/-") {
            wi.relations.push(op.value);
          }
        }
        wi.rev++;
        const fields = Object.fromEntries(ops.filter(op => op.path?.startsWith('/fields/')).map(op => [op.path.slice(8), { newValue: op.value }]));
        const list = updates.get(wi.id) ?? []; list.push({ id: list.length + 1, workItemId: wi.id, rev: wi.rev, fields }); updates.set(wi.id, list);
        json(200, wi);
      });
      return;
    }
    json(404, { message: `stub miss: ${req.method} ${p}` });
  });
  return new Promise((resolve) => {
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port, wis }));
  });
}

const TASKS_CHECKED = "- [x] 1.1 实现\n- [x] 1.2 验证\n";

function evidenceFor(changeDir, opts = {}) {
  const ev = {
    change_ref: CHANGE_REF,
    task_refs: ["1.1"],
    local_validation: { result: "PASS", summary: "ok" },
    code_review: { result: "PASS", findings: [] },
    commits: [],
  };
  if (!opts.omitContractFiles) {
    // 以"未勾选"文本计算哈希：勾选变化不改契约哈希（normalizeContractText 归一），gate 仍应 PASS
    const tasksPath = join(changeDir, "tasks.md");
    const checked = readFileSync(tasksPath, "utf8");
    writeFileSync(tasksPath, checked.replace(/- \[x\]/g, "- [ ]"));
    ev.contract_files = computeContractFiles(changeDir);
    writeFileSync(tasksPath, checked);
  }
  if (opts.corruptHash) ev.contract_files.files["proposal.md"] = "0".repeat(64);
  return ev;
}

function baseMetadata(extra = {}) {
  return {
    "tfs.id": "999", "tfs.type": "Bug",
    "analysis.change_kind": "corrective", "analysis.change_ref": CHANGE_REF,
    "analysis.gate.result": "PASS",
    "analysis.human_approval": JSON.stringify({ decision: "approved", by: "human", at: "2026-11-08T00:00:00Z", comment_ref: "c-0", verify_agent_required: false }),
    "analysis.verify_agent.recommendation": "not_required",
    "verify_agent.required": "false",
    current_pr: JSON.stringify([{ repo_key: "repo1", pr_id: 1, pr_url: "http://x/pr/1", source_branch: "feat-1", target_branch: "main" }]),
    "dev.dispatch": JSON.stringify([{
      dispatch_key: "WNDF-T#1.1#eng-1", task_refs: ["1.1"], engineer_id: "eng-1", engineer_name: "Eng",
      projection: "parent", sub_issue_ref: null, change_ref: CHANGE_REF, approved_comment_ref: "c-0",
      dispatched_at: "2026-11-01T00:00:00.000Z", active: true,
    }]),
    ...extra,
  };
}

/**
 * 组装一套完整 fixture。opts.evidenceMode: "ok" | "corrupt" | "no_contract_files" | "none"；
 * opts.commitChange: 是否预先提交 change 目录（false → 留给 M2.3 先保存）；
 * opts.preArchived / opts.wiState / opts.metadata 覆盖。
 */
async function fixture(t, opts = {}) {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "finalize-contract-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const opsLog = join(dir, "ops.log");
  // 平台 Task/Workspace 身份：Requirement 收口根仓按平台 checkout 契约校验。
  const taskId = "01a1d2fc-da3a-796b-9584-f8f23e188c07";
  const taskSuffix = taskId.replace(/-/g, "").slice(-12);
  const workspaceId = "ws-test";

  // 假 openspec
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "openspec.js"), FAKE_OPENSPEC_JS);
  writeFileSync(join(bin, "openspec.cmd"), `@echo off\r\nnode "%~dp0openspec.js" %*\r\n`);
  writeFileSync(join(bin, "openspec"), `#!/bin/sh\nnode "$(dirname "$0")/openspec.js" "$@"\n`);
  chmodSync(join(bin, "openspec"), 0o755);

  // 根仓（bare remote + 本地；dev 分支）
  const rootRemote = join(dir, "root-remote.git");
  mkdirSync(rootRemote);
  git(rootRemote, "init", "--bare");
  // Requirement root is directly inside the Task workdir, without a Rondo-owned parent.
  const rootRepo = opts.requirement ? join(dir, "root") : join(dir, "root-repo");
  mkdirSync(rootRepo);
  git(rootRepo, "init");
  git(rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init");
  git(rootRepo, "branch", "-M", "dev");
  git(rootRepo, "remote", "add", "origin", rootRemote);
  git(rootRepo, "push", "origin", "dev");
  writeFileSync(join(rootRepo, ".gitignore"), "repo1/\n.worktrees/\n.multica/\n");
  writeFileSync(join(rootRepo, "AGENTS.md"), "# 项目规则\n");
  git(rootRepo, "add", ".gitignore", "AGENTS.md");
  git(rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "gitignore");

  // change 目录
  const changeParent = opts.preArchived ? join(rootRepo, "openspec", "changes", "archive", `2026-01-01-${CHANGE_REF}`) : join(rootRepo, "openspec", "changes", CHANGE_REF);
  mkdirSync(join(changeParent, "specs", "cap1"), { recursive: true });
  writeFileSync(join(changeParent, ".openspec.yaml"), opts.requirement
    ? "schema: corrective-change\nx-repositories: [repo1]\n" : "schema: corrective-change\n");
  writeFileSync(join(changeParent, "proposal.md"), "# 提案\n");
  writeFileSync(join(changeParent, "tasks.md"), TASKS_CHECKED);
  writeFileSync(join(changeParent, "specs", "cap1", "spec.md"), "# cap1 spec\n");
  const evidenceMode = opts.evidenceMode ?? "ok";
  if (evidenceMode !== "none") {
    const ev = evidenceFor(changeParent, {
      omitContractFiles: evidenceMode === "no_contract_files",
      corruptHash: evidenceMode === "corrupt",
    });
    writeFileSync(join(changeParent, "evidence.json"), JSON.stringify(ev, null, 2));
  }
  if (opts.preArchived) {
    mkdirSync(join(rootRepo, "openspec", "specs", "cap1"), { recursive: true });
    writeFileSync(join(rootRepo, "openspec", "specs", "cap1", "spec.md"), "# cap1 spec\n");
  }
  if (opts.commitChange !== false) {
    git(rootRepo, "add", "openspec");
    git(rootRepo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed change");
  }
  git(rootRepo, "push", "origin", "dev");

  // 业务仓 remote + 枢纽克隆（main 分支，干净）
  const bizRemote = join(dir, "biz-remote.git");
  mkdirSync(bizRemote);
  git(bizRemote, "init", "--bare");
  const seed = join(dir, "seed");
  mkdirSync(seed);
  git(seed, "init");
  writeFileSync(join(seed, "a.txt"), "a");
  git(seed, "add", "a.txt");
  git(seed, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "seed");
  git(seed, "branch", "-M", "main");
  git(seed, "remote", "add", "origin", bizRemote);
  git(seed, "push", "origin", "main");
  // bare 仓 HEAD 默认指 master——不纠正则 clone 出来是 unborn HEAD（空检出）
  git(bizRemote, "symbolic-ref", "HEAD", "refs/heads/main");
  git(dir, "clone", bizRemote, join(rootRepo, "repo1"));

  // TFS stub
  const tfsControl = { denyStateWrite: opts.denyTfsStateWrite === true };
  const { srv, port, wis } = await startTfsStub(opts.wiState ?? "活动", opsLog, tfsControl, opts.requirement ? rootRemote : undefined);
  t.after(() => srv.close());
  const tfsUrl = `http://127.0.0.1:${port}${opts.requirement ? "/tfs/Test" : ""}`;
  let metadata = baseMetadata(opts.metadata);
  if (opts.requirement) {
    git(rootRemote, "symbolic-ref", "HEAD", "refs/heads/dev");
    git(rootRemote, "update-server-info");
    const source = { repo_url: tfsUrl + "/Proj1/_git/root", branch: "dev", commit: git(rootRepo, "rev-parse", "HEAD"), change_ref: CHANGE_REF };
    git(rootRepo, "remote", "set-url", "origin", source.repo_url);
    // Keep the platform agent branch as evidence; all archive commits use a Task-local branch.
    git(rootRepo, "config", "multica.checkout-mode", "isolated");
    git(rootRepo, "switch", "-c", "agent/pr-status-sync-agent/" + taskSuffix);
    git(rootRepo, "switch", "-c", "rondo/closeout/" + taskSuffix + "/dev");
    metadata = {
      ...metadata,
      "tfs.type": "需求",
      "analysis.source": JSON.stringify(source),
      "dev.dispatch": undefined,
      pr_prep: JSON.stringify([{
        repo_key: "repo1", source_branch: "feature/999", target_branch: "main",
        candidate_commit: git(seed, "rev-parse", "HEAD"), title: "Requirement delivery",
        description: "Implementation and verification completed",
        local_validation: { result: "PASS", summary: "Verified", command: ["node", "--test"], exit_code: 0,
          candidate_commit: git(seed, "rev-parse", "HEAD"), source: "rondo dev pr-prep" },
        code_review: { result: "PASS", summary: "Reviewed", findings: [],
          candidate_commit: git(seed, "rev-parse", "HEAD") },
        blockers: [],
      }]),
    };
  }

  // multica mock state
  chmodSync(MOCK, 0o755);
  const config = join(dir, "registry.json");
  writeFileSync(config, JSON.stringify({
    runtime: { multica_cli: MOCK, workspace_id: "ws-test" },
    registry: { repo1: { repo_path: "repo1", repo_url: bizRemote, default_target_branch: "main",
      tfs_repo: "repo1", tfs_project: "Proj1" } },
  }));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({
    issues: {
      "WNDF-T": { id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: "in_progress", metadata },
    },
  }));

  const env = { ...process.env };
  for (const k of ["TFS_URL", "TFS_COLLECTION", "TFS_PROJECT", "TFS_CLI_CONFIG", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"]) delete env[k];
  // Windows 环境键可能为 Path；只保留一个键，避免子进程选择错误的 PATH。
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === "path");
  const inheritedPath = env[pathKey] ?? "";
  for (const k of Object.keys(env)) if (k.toLowerCase() === "path") delete env[k];
  Object.assign(env, {
    MOCK_STATE: statePath, MOCK_ROOT_REPO: rootRepo, OPS_LOG: opsLog,
    ARCHIVE_TEST_HOOK: join(dir, "archive-hook.cjs"),
    TFS_SERVER_URL: tfsUrl, TFS_PAT: "dummy-pat",
    MULTICA_TASK_ID: taskId, MULTICA_WORKSPACE_ID: workspaceId,
    PATH: bin + delimiter + inheritedPath,
  });

  // 模拟 PR Status Sync Agent 的同一个 Run：Prepare → 独立 TFS Writeback → Complete。
  // 每段都是真实 CLI 子进程；测试组合结果仅用于兼容既有 Finalize 契约断言。
  const runCli = (args) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { env, cwd: dir });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => { stdout += d; });
    child.stderr.on("data", d => { stderr += d; });
    child.on("error", reject);
    child.on("close", code => {
      let body = null;
      try { body = JSON.parse(stdout); } catch { /* 交给测试断言 */ }
      resolve({ exit: code, stdout, stderr, body });
    });
  });
  const phase = (name, extraArgs = []) =>
    runCli(["delivery", "finalize", "--phase", name, "--issue", "WNDF-T", "--config", config, "--root-repo", rootRepo, ...extraArgs]);
  const writeback = () => runCli(["tfs", "writeback", "--issue", "WNDF-T", "--config", config, "--root-repo", rootRepo]);

  const run = async (extraArgs = []) => {
    const prepared = await phase("prepare", extraArgs);
    if (prepared.exit !== 0 || prepared.body?.already === "done") return prepared;
    assert.equal(prepared.body?.status, "prepared", prepared.stdout + prepared.stderr);
    const tfs = await writeback();
    if (tfs.exit !== 0) return tfs;
    assert.equal(tfs.body?.result, "PASS", tfs.stdout + tfs.stderr);
    const completed = await phase("complete", extraArgs);
    if (completed.exit !== 0) return completed;
    const mergedSteps = {
      ...prepared.body.steps,
      tfs_writeback: { status: "done", detail: tfs.body },
      ...completed.body.steps,
      // The second phase only rechecks an already archived Change; retain the
      // original prepare evidence for the combined legacy-compatible fixture.
      route_archive: prepared.body.steps.route_archive,
    };
    const orderedSteps = Object.fromEntries(STEPS_GOLDEN.filter(k => mergedSteps[k]).map(k => [k, mergedSteps[k]]));
    return { ...completed, stderr: prepared.stderr + tfs.stderr + completed.stderr,
      body: { ...completed.body, steps: orderedSteps } };
  };

  const readState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const readOps = () => (existsSync(opsLog) ? readFileSync(opsLog, "utf8").trim().split("\n") : []);
  return { run, phase, writeback, readState, readOps, rootRepo, rootRemote, changeDir: changeParent, dir, wis, tfsControl,
    archiveHook: join(dir, "archive-hook.cjs") };
}

test("T1 happy finalize：PASS + steps 键序 golden + archive<writeback<summary 顺序 + push 到达", async (t) => {
  const f = await fixture(t);
  const r = await f.run();
  assert.equal(r.exit, 0, `stderr=${r.stderr.slice(0, 800)}`);
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.status, "done");
  assert.deepEqual(Object.keys(r.body.steps), STEPS_GOLDEN, "stdout steps 键序与旧序一致");
  assert.equal(r.body.steps.summary.status, "done");
  assert.equal(r.body.steps.route_archive.detail.archive.endsWith(`2026-01-01-${CHANGE_REF}`), true);
  assert.equal(r.body.steps.route_archive.detail.artifacts_committed, undefined, "净树进场：无 artifacts_committed key");
  assert.equal(r.body.steps.route_archive.detail.pushed, true);
  assert.equal(r.body.steps.tfs_writeback.detail.parent_writeback.state, "已解决");

  const ops = f.readOps();
  const idx = (k) => ops.indexOf(k);
  assert.ok(idx("archive") !== -1 && idx("tfs-state") !== -1 && idx("tfs-comment") !== -1 && idx("multica-comment issue-1") !== -1, `ops=${ops.join(",")}`);
  assert.ok(idx("archive") < idx("tfs-state") && idx("tfs-comment") < idx("multica-comment issue-1"), "顺序：archive < writeback < summary");

  const st = f.readState();
  const issue = st.issues["WNDF-T"];
  assert.equal(issue.status, "done");
  assert.equal(issue.metadata["finalize.pending"], undefined);
  assert.equal(issue.metadata["delivery.tfs_written"], "true");
  assert.ok(issue.metadata["delivery.summary_comment_id"]);
  assert.equal(st.comments["issue-1"].length, 1);
  assert.match(st.comments["issue-1"][0].content, /已归档/);
  assert.equal(f.wis.get(999).fields["System.State"], "已解决");

  // 归档发生且 push 到达
  assert.ok(existsSync(join(f.rootRepo, "openspec", "changes", "archive", `2026-01-01-${CHANGE_REF}`)));
  assert.ok(!existsSync(join(f.rootRepo, "openspec", "changes", CHANGE_REF)));
  const remoteLog = git(f.rootRemote, "log", "dev", "--format=%s");
  assert.match(remoteLog, new RegExp(`archive: ${CHANGE_REF} \\(WNDF-T / tfs 999\\)`));
});

test("T2 gate 三态：旧 hash → exit 2；缺 contract_files → exit 3；无适用 Evidence → exit 3", async (t) => {
  const corrupt = await fixture(t, { evidenceMode: "corrupt" });
  const r1 = await corrupt.run();
  assert.equal(r1.exit, 2, `stdout=${r1.stdout.slice(0, 400)}`);
  assert.equal(r1.body.result, "FAIL");
  assert.match(r1.body.reason, /契约文件核验不过/);

  const noCf = await fixture(t, { evidenceMode: "no_contract_files" });
  const r2 = await noCf.run();
  assert.equal(r2.exit, 3);
  assert.match(r2.body.reason, /缺 contract_files/);

  const noEv = await fixture(t, { evidenceMode: "none" });
  const r3 = await noEv.run();
  assert.equal(r3.exit, 3);
  assert.match(r3.body.reason, /缺覆盖 active 派发的 Evidence/);
});

test("T3 M2.3：未提交 Change 工件先 finalize: 提交再归档；foreign 预暂存 → exit 3 不提交", async (t) => {
  const f = await fixture(t, { commitChange: false });
  const r = await f.run();
  assert.equal(r.exit, 0, `stdout=${r.stdout.slice(0, 400)} stderr=${r.stderr.slice(0, 400)}`);
  assert.ok(r.body.steps.route_archive.detail.artifacts_committed > 0, "工件先提交");
  const log = git(f.rootRemote, "log", "dev", "--format=%s");
  // git log 逆序（新→旧）：archive 的行号应小于 finalize 的行号，证明 finalize 提交先发生
  const lines = log.split("\n");
  assert.ok(lines.findIndex((l) => l.startsWith(`archive: ${CHANGE_REF}`)) < lines.findIndex((l) => l.startsWith(`finalize: ${CHANGE_REF}`)), "finalize 提交先于 archive 提交");

  // foreign 预暂存 → UNKNOWN 且不提交
  const f2 = await fixture(t, { commitChange: false });
  writeFileSync(join(f2.rootRepo, "outside.txt"), "foreign");
  git(f2.rootRepo, "add", "outside.txt");
  const r2 = await f2.run();
  assert.equal(r2.exit, 3);
  assert.match(r2.body.reason, /本 Change 之外的(改动|内容)/);
  const log2 = git(f2.rootRemote, "log", "dev", "--format=%s");
  assert.ok(!log2.includes(`finalize: ${CHANGE_REF}`), "foreign 时不得提交");
});

test("T4 M2.5：首次 Archive 前任何遗留 Specs 都不得夹带，正常 Archive 仍生成所属 Specs", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.rootRepo, "openspec", "specs", "other"), { recursive: true });
  writeFileSync(join(f.rootRepo, "openspec", "specs", "other", "spec.md"), "foreign cap");
  const r1 = await f.run();
  assert.equal(r1.exit, 3);
  assert.match(r1.body.reason, /本 Change 之外的改动/);

  const f2 = await fixture(t);
  mkdirSync(join(f2.rootRepo, "openspec", "specs", "cap1"), { recursive: true });
  writeFileSync(join(f2.rootRepo, "openspec", "specs", "cap1", "extra.md"), "touched cap extra");
  const r2 = await f2.run();
  assertPending(f2, r2);
  assert.match(r2.body.reason, /首次 Archive 前存在已修改的 Specs/);
  assert.ok(existsSync(join(f2.rootRepo, "openspec", "specs", "cap1", "extra.md")));
  assert.ok(!f2.readOps().includes("archive"));
  const clean = await fixture(t);
  const ok = await clean.run();
  assert.equal(ok.exit, 0, ok.stdout + ok.stderr);
  assert.equal(readFileSync(join(clean.rootRepo, "openspec", "specs", "cap1", "spec.md"), "utf8"), "# cap1 spec\n");
});

test("T5 续走：完成后重跑 → done-shortcut；预置已归档+writeback 完成 → summary 恰一次", async (t) => {
  const f = await fixture(t);
  const r1 = await f.run();
  assert.equal(r1.exit, 0);
  const r2 = await f.run();
  assert.equal(r2.exit, 0);
  assert.deepEqual(r2.body, { result: "PASS", issue: "WNDF-T", already: "done", steps: {} });

  // 恢复场景：已归档 + tfs_written 已置位 + 无 summary_comment_id → summary 恰好发一次
  const g = await fixture(t, {
    preArchived: true,
    wiState: "已解决",
    metadata: { "delivery.tfs_written": "true", "finalize.pending": JSON.stringify({ event_keys: ["WNDF-T#repo1#1#completed"], recorded_at: "t" }) },
  });
  const rg = await g.run();
  assert.equal(rg.exit, 0, `stdout=${rg.stdout.slice(0, 500)} stderr=${rg.stderr.slice(0, 500)}`);
  assert.equal(rg.body.steps.route_archive.detail.archive, "skipped_already_archived");
  assert.equal(rg.body.steps.pending_written.status, "skipped");
  assert.equal(rg.body.steps.tfs_writeback.detail.parent_writeback.status, "skipped");
  assert.equal(rg.body.steps.summary.status, "done");
  assert.equal(g.readState().comments["issue-1"].length, 1, "summary 恰好发一次");
});

test("归档移动后提交前中断：重跑提交本次归档，不再次 archive", async (t) => {
  const f = await fixture(t);
  const archiveParent = join(f.rootRepo, "openspec", "changes", "archive");
  mkdirSync(archiveParent, { recursive: true });
  renameSync(f.changeDir, join(archiveParent, `2026-01-01-${CHANGE_REF}`));
  const r = await f.run();
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.body.steps.route_archive.detail.archive, "skipped_already_archived");
  assert.equal(r.body.steps.route_archive.detail.pushed, true);
  assert.equal(f.readOps().includes("archive"), false);
  assert.equal(git(f.rootRepo, "status", "--porcelain"), "");
  assert.match(git(f.rootRemote, "log", "dev", "--format=%s"), /archive: c-fin/);
});

test("归档恢复仍拒绝夹带其他 Change，保留未提交现场", async (t) => {
  const f = await fixture(t, { preArchived: true });
  const other = join(f.rootRepo, "openspec", "changes", "archive", "2026-01-01-other");
  mkdirSync(other, { recursive: true });
  writeFileSync(join(other, "proposal.md"), "other change");
  const r = await f.run();
  assert.equal(r.exit, 3);
  assert.match(r.body.reason, /本 Change 之外的改动/);
  assert.ok(existsSync(join(other, "proposal.md")));
  assert.equal(f.readOps().includes("multica-comment issue-1"), false);
});

/** 独立克隆模拟远端提交；所有 Git 副作用只发生在 fixture 的临时仓库。 */
function remoteWriter(f) {
  const peer = join(f.dir, "peer");
  git(f.dir, "clone", "--branch", "dev", f.rootRemote, peer);
  return peer;
}

function commitFile(repo, file, content) {
  mkdirSync(join(repo, file, ".."), { recursive: true });
  writeFileSync(join(repo, file), content);
  git(repo, "add", "--", file);
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", `update ${file}`);
}

function assertPending(f, result) {
  assert.equal(result.exit, 3, result.stdout + result.stderr);
  const issue = f.readState().issues["WNDF-T"];
  assert.notEqual(issue.status, "done");
  assert.ok(issue.metadata["finalize.pending"]);
  assert.equal(f.wis.get(999).fields["System.State"], "活动");
  assert.ok(!f.readOps().includes("multica-comment issue-1"));
  assert.doesNotMatch(result.stderr, /\$ git (?:pull --rebase|rebase)\b/);
}

test("归档允许 openspec 外未暂存改动：运行时指令与未跟踪文件保留且不进入提交", async (t) => {
  const f = await fixture(t, { commitChange: false });
  const runtime = "# 项目规则\n<!-- BEGIN MULTICA-RUNTIME -->\n运行时指令\n<!-- END MULTICA-RUNTIME -->\n";
  writeFileSync(join(f.rootRepo, "AGENTS.md"), runtime);
  writeFileSync(join(f.rootRepo, "运行日志.txt"), "保留日志");
  const base = git(f.rootRepo, "rev-parse", "HEAD");
  const r = await f.run();
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), runtime);
  assert.equal(readFileSync(join(f.rootRepo, "运行日志.txt"), "utf8"), "保留日志");
  const changed = git(f.rootRemote, "diff", "--name-only", base, "dev").split("\n");
  assert.ok(changed.every(p => p.startsWith("openspec/")), changed.join("\n"));
  assert.doesNotMatch(r.stderr, /\$ git (?:pull --rebase|rebase)\b/);
});

test("归档前拒绝外来暂存内容，即使当前 Change 无待保存工件", async (t) => {
  const f = await fixture(t);
  writeFileSync(join(f.rootRepo, "outside.txt"), "用户暂存内容");
  git(f.rootRepo, "add", "outside.txt");
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  const index = git(f.rootRepo, "diff", "--cached", "--binary");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /暂存区/);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.equal(git(f.rootRepo, "diff", "--cached", "--binary"), index);
  assert.ok(!f.readOps().includes("archive"));
});

test("归档后再次检查暂存区，拒绝夹带执行期间新增的外来暂存内容", async (t) => {
  const f = await fixture(t);
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  writeFileSync(f.archiveHook, `
    const fs = require('fs'), path = require('path'), cp = require('child_process');
    fs.writeFileSync(path.join(process.cwd(), 'outside.txt'), '外来内容');
    cp.execFileSync('git', ['-C', process.cwd(), 'add', 'outside.txt']);
  `);
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /暂存区/);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.match(git(f.rootRepo, "diff", "--cached", "--name-only"), /outside.txt/);
  assert.ok(existsSync(join(f.rootRepo, "openspec/changes/archive/2026-01-01-c-fin")));
});

test("根仓落后时先快进再保存工件，保留 AGENTS.md 未暂存改动", async (t) => {
  const f = await fixture(t, { commitChange: false });
  const peer = remoteWriter(f);
  commitFile(peer, "README.md", "远端更新\n");
  git(peer, "push", "origin", "dev");
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const r = await f.run();
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
  assert.equal(readFileSync(join(f.rootRepo, "README.md"), "utf8"), "远端更新\n");
  assert.ok(r.stderr.indexOf("merge --ff-only") < r.stderr.indexOf("commit -m finalize:"), r.stderr);
});

test("快进会覆盖运行时指令时停止，不改写 AGENTS.md 或本地 HEAD", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, "AGENTS.md", "远端项目规则\n");
  git(peer, "push", "origin", "dev");
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  const r = await f.run();
  assertPending(f, r);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
  assert.ok(!f.readOps().includes("archive"));
});

test("已有分叉时停止：不创建保存或归档提交，不移动 Change，不改暂存区", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, "README.md", "远端推进\n");
  git(peer, "push", "origin", "dev");
  commitFile(f.rootRepo, `openspec/changes/${CHANGE_REF}/local.md`, "本地工件\n");
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /分叉/);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.equal(git(f.rootRepo, "diff", "--cached", "--name-only"), "");
  assert.ok(existsSync(f.changeDir));
  assert.ok(!f.readOps().includes("archive"));
});

test("本地领先但包含范围外提交时停止，不能借归档一起推送", async (t) => {
  const f = await fixture(t);
  commitFile(f.rootRepo, "outside.txt", "其他任务的本地提交\n");
  const remoteHead = git(f.rootRemote, "rev-parse", "dev");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /待推送提交/);
  assert.equal(git(f.rootRemote, "rev-parse", "dev"), remoteHead);
  assert.ok(!f.readOps().includes("archive"));
});

test("归档期间远端推进：保留本地归档提交与 pending，重跑也不 rebase 或重复归档", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, "README.md", "并发远端提交\n");
  writeFileSync(f.archiveHook, `require('child_process').execFileSync('git', ['-C', ${JSON.stringify(peer)}, 'push', 'origin', 'dev']);`);
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /分叉/);
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  assert.match(git(f.rootRepo, "log", "-1", "--format=%s"), /archive:/);
  assert.doesNotMatch(git(f.rootRemote, "log", "dev", "--format=%s"), /archive:/);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
  const retry = await f.run();
  assertPending(f, retry);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.equal(f.readOps().filter(x => x === "archive").length, 1);
});

test("快进改变当前契约时停止，不使用旧 Gate 继续归档", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, `openspec/changes/${CHANGE_REF}/proposal.md`, "# 修改后的契约\n");
  git(peer, "push", "origin", "dev");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /契约.*漂移/);
  assert.ok(!f.readOps().includes("archive"));
});

test("已归档恢复允许运行时改动，并只推送本次归档提交", async (t) => {
  const f = await fixture(t);
  mkdirSync(join(f.rootRepo, "openspec/changes/archive"));
  renameSync(f.changeDir, join(f.rootRepo, "openspec/changes/archive/2026-01-01-c-fin"));
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const r = await f.run();
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.body.steps.route_archive.detail.archive, "skipped_already_archived");
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
  assert.ok(!f.readOps().includes("archive"));
});

test("需要快进但当前 Change 有暂存内容时停止，保留索引与工作区", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, "README.md", "远端更新\n");
  git(peer, "push", "origin", "dev");
  writeFileSync(join(f.changeDir, "note.md"), "暂存的交付说明\n");
  git(f.rootRepo, "add", "openspec");
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  const index = git(f.rootRepo, "diff", "--cached", "--binary");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /需要快进但暂存区非空/);
  assert.equal(git(f.rootRepo, "rev-parse", "HEAD"), head);
  assert.equal(git(f.rootRepo, "diff", "--cached", "--binary"), index);
  assert.ok(!f.readOps().includes("archive"));
});

test("领先的当前 Change 提交允许续走，不要求根仓完全无本地提交", async (t) => {
  const f = await fixture(t);
  // Windows 禁止文件名包含 >；两侧都覆盖中文和空格，POSIX 额外覆盖 porcelain 的箭头歧义。
  const note = process.platform === "win32" ? "交付 → 说明.md" : "交付 -> 说明.md";
  commitFile(f.rootRepo, `openspec/changes/${CHANGE_REF}/${note}`, "补充说明\n");
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const r = await f.run();
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
  assert.ok(existsSync(join(f.rootRepo, "openspec/changes/archive/2026-01-01-c-fin", note)));
});

test("范围外提交先改后还原也拒绝推送，不能只检查净差异", async (t) => {
  const f = await fixture(t);
  commitFile(f.rootRepo, "AGENTS.md", "其他任务的改动\n");
  commitFile(f.rootRepo, "AGENTS.md", "# 项目规则\n");
  assert.equal(git(f.rootRepo, "diff", "origin/dev", "HEAD", "--", "AGENTS.md"), "");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /待推送提交.*AGENTS.md/);
  assert.ok(!f.readOps().includes("archive"));
});

test("前导空格的范围外路径不能伪装成 openspec 路径", async (t) => {
  const f = await fixture(t);
  const file = ` openspec/changes/${CHANGE_REF}/foreign.md`;
  mkdirSync(join(f.rootRepo, " openspec/changes", CHANGE_REF), { recursive: true });
  writeFileSync(join(f.rootRepo, file), "范围外内容\n");
  git(f.rootRepo, "add", "--", file);
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /暂存区/);
  assert.ok(!f.readOps().includes("archive"));
});

test("远端未接受 Push 时安全停止，下一轮依据远端事实恢复而不重复 Archive", async (t) => {
  const f = await fixture(t);
  const hooks = join(f.dir, "hooks");
  mkdirSync(hooks);
  const hook = join(hooks, "pre-push");
  writeFileSync(hook, '#!/bin/sh\nif test ! -f "$0.once"; then\n  touch "$0.once"\n  exit 1\nfi\nexit 0\n');
  chmodSync(hook, 0o755);
  git(f.rootRepo, "config", "core.hooksPath", hooks);
  const first = await f.phase("prepare");
  assertPending(f, first);
  assert.match(first.body.reason, /Push 未确认|Non-Fast-Forward/);
  assert.equal(f.readOps().filter(x => x === "archive").length, 1);
  const resumed = await f.run();
  assert.equal(resumed.exit, 0, resumed.stdout + resumed.stderr);
  assert.equal(f.readOps().filter(x => x === "archive").length, 1);
  assert.doesNotMatch(resumed.stderr, /\$ git (?:pull --rebase|rebase)\b/);
});

test("推送时远端才前进：拒绝后回核分叉，不自动 rebase 或再次推送", async (t) => {
  const f = await fixture(t);
  const peer = remoteWriter(f);
  commitFile(peer, "README.md", "推送竞争\n");
  const hooks = join(f.dir, "hooks");
  mkdirSync(hooks);
  const hook = join(hooks, "pre-push");
  // 在本地最后一次 fetch 之后推进远端，真实触发 Git push 拒绝。
  writeFileSync(hook, `#!/bin/sh\ngit -C "${peer.replaceAll("\\", "/")}" push origin dev\n`);
  chmodSync(hook, 0o755);
  git(f.rootRepo, "config", "core.hooksPath", hooks);
  writeFileSync(join(f.rootRepo, "AGENTS.md"), "运行时指令\n");
  const r = await f.run();
  assertPending(f, r);
  assert.match(r.body.reason, /Push 未确认|Non-Fast-Forward/);
  assert.match(git(f.rootRepo, "log", "-1", "--format=%s"), /archive:/);
  assert.doesNotMatch(git(f.rootRemote, "log", "dev", "--format=%s"), /archive:/);
  assert.equal(readFileSync(join(f.rootRepo, "AGENTS.md"), "utf8"), "运行时指令\n");
});

test("D3-B: TFS writeback cannot run before prepared archive, even with valid work item", async t => {
  const f = await fixture(t);
  const result = await f.writeback();
  assert.equal(result.exit, 2, result.stdout + result.stderr);
  assert.match(result.body.reason, /finalize.pending/);
  assert.notEqual(f.readState().issues["WNDF-T"].status, "done");
  assert.equal(f.wis.get(999).fields["System.State"], "活动");
  assert.equal(f.readOps().includes("archive"), false);
});

test("Requirement 首次 Prepare 复用完成 Gate，未完成 tasks 不归档", async t => {
  const f = await fixture(t, { requirement: true });
  writeFileSync(join(f.changeDir, "tasks.md"), "- [ ] 1.1 Pending\n");
  const r = await f.phase("prepare");
  assert.equal(r.exit, 2, r.stdout + r.stderr);
  assert.match(r.body.reason, /未完成|tasks\.md/);
  assert.ok(existsSync(f.changeDir));
  assert.ok(!f.readOps().includes("archive"));
  assert.equal(f.wis.get(999).fields["System.State"], "活动");
});

test("Requirement 已归档且 Gate 满足时可补 Prepare 回读，不重复 Archive", async t => {
  const f = await fixture(t, { requirement: true, preArchived: true });
  const r = await f.phase("prepare");
  assert.equal(r.exit, 0, r.stdout + r.stderr);
  assert.equal(r.body.status, "prepared");
  assert.equal(r.body.steps.completion_gate.status, "done");
  assert.equal(r.body.steps.route_archive.detail.archive, "skipped_already_archived");
  assert.equal(f.readOps().includes("archive"), false);
});

test("Requirement 已 Prepare 时仅回读归档，保留 pending 并直接放行 TFS Writeback", async t => {
  const pending = JSON.stringify({ event_keys: ["WNDF-T#repo1#1#completed"], prepared_change_ref: CHANGE_REF, recorded_at: "t" });
  const f = await fixture(t, { requirement: true, preArchived: true, metadata: { "finalize.pending": pending } });
  const head = git(f.rootRepo, "rev-parse", "HEAD");
  const resumed = await f.phase("prepare");
  assert.equal(resumed.exit, 0, resumed.stdout + resumed.stderr);
  assert.equal(resumed.body.status, "prepared");
  assert.equal(resumed.body.steps.route_archive.status, "skipped");
  assert.equal(resumed.body.steps.archive_readback.detail.commit, head);
  assert.equal((resumed.stderr.match(/\$ git fetch origin/g) ?? []).length, 1);
  assert.doesNotMatch(resumed.stderr, /\$ git (?:merge|commit|push) |issue metadata set/);
  assert.equal(f.readState().issues["WNDF-T"].metadata["finalize.pending"], pending);
  assert.deepEqual(f.readOps(), []);
});

test("Requirement 已 Prepare 但远端仍为活跃 Change 时停止恢复", async t => {
  const pending = JSON.stringify({ event_keys: ["WNDF-T#repo1#1#completed"], prepared_change_ref: CHANGE_REF });
  const f = await fixture(t, { requirement: true, metadata: { "finalize.pending": pending } });
  const resumed = await f.phase("prepare");
  assert.equal(resumed.exit, 3, resumed.stdout + resumed.stderr);
  assert.match(resumed.body.reason, /远端.*(?:归档|Archive)/);
  assert.deepEqual(f.readOps(), []);
  assert.equal(f.readState().issues["WNDF-T"].metadata["finalize.pending"], pending);
});

test("Requirement 的 pending 与当前 PR 或 Change 不一致时拒绝恢复", async t => {
  for (const [eventKey, changeRef, reason] of [
    ["WNDF-T#repo1#2#completed", CHANGE_REF, /PR 完成事件不一致/],
    ["WNDF-T#repo1#1#completed", "another-change", /Change 不一致/],
  ]) {
    const pending = JSON.stringify({ event_keys: [eventKey], prepared_change_ref: changeRef });
    const f = await fixture(t, { requirement: true, preArchived: true, metadata: { "finalize.pending": pending } });
    const resumed = await f.phase("prepare");
    assert.equal(resumed.exit, 2, resumed.stdout + resumed.stderr);
    assert.match(resumed.body.reason, reason);
    assert.doesNotMatch(resumed.stderr, /\$ git fetch origin/);
    assert.equal(f.readState().issues["WNDF-T"].metadata["finalize.pending"], pending);
  }
});

test("D3-B: prepared Delivery cannot become done before TFS writeback succeeds", async t => {
  const f = await fixture(t);
  const p = await f.phase("prepare");
  assert.equal(p.exit, 0, p.stdout + p.stderr);
  assert.equal(p.body.status, "prepared");
  assert.ok(f.readState().issues["WNDF-T"].metadata["finalize.pending"]);
  assert.notEqual(f.readState().issues["WNDF-T"].status, "done");
  assert.equal(f.wis.get(999).fields["System.State"], "活动");

  const early = await f.phase("complete");
  assert.equal(early.exit, 3, early.stdout + early.stderr);
  assert.match(early.body.reason, /TFS Writeback/);
  assert.notEqual(f.readState().issues["WNDF-T"].status, "done");

  const written = await f.writeback();
  assert.equal(written.exit, 0, written.stdout + written.stderr);
  assert.equal(written.body.result, "PASS");
  const completed = await f.phase("complete");
  assert.equal(completed.exit, 0, completed.stdout + completed.stderr);
  assert.equal(completed.body.status, "done");
  assert.equal(f.readState().issues["WNDF-T"].metadata["finalize.pending"], undefined);
  assert.equal(f.readOps().filter(x => x === "archive").length, 1);
});

test("D3-B: missing TFS parent blocks Issue done; recovery reuses archived Change", async t => {
  const f = await fixture(t);
  const prepared = await f.phase("prepare");
  assert.equal(prepared.exit, 0, prepared.stdout + prepared.stderr);
  const saved = f.wis.get(999);
  f.wis.delete(999);
  const failed = await f.writeback();
  assert.ok([2, 3].includes(failed.exit), failed.stdout + failed.stderr);
  assert.notEqual(f.readState().issues["WNDF-T"].status, "done");
  assert.ok(f.readState().issues["WNDF-T"].metadata["finalize.pending"]);
  f.wis.set(999, saved);
  const resumed = await f.phase("prepare");
  assert.equal(resumed.exit, 0, resumed.stdout + resumed.stderr);
  assert.equal(resumed.body.steps.route_archive.detail.archive, "skipped_already_archived");
  const ok = await f.writeback();
  assert.equal(ok.exit, 0, ok.stdout + ok.stderr);
  const done = await f.phase("complete");
  assert.equal(done.exit, 0, done.stdout + done.stderr);
  assert.equal(f.readOps().filter(x => x === "archive").length, 1);
});

test("D3-B: pending and local archive without confirmed Prepare must not permit TFS writeback", async t => {
  const f = await fixture(t, {
    preArchived: true,
    metadata: { "finalize.pending": JSON.stringify({ event_keys: ["WNDF-T#repo1#1#completed"], recorded_at: "t" }) },
  });
  const rejected = await f.writeback();
  assert.equal(rejected.exit, 2, rejected.stdout + rejected.stderr);
  assert.match(rejected.body.reason, /Prepare/);
  assert.equal(f.wis.get(999).fields["System.State"], "活动");
  const prepared = await f.phase("prepare");
  assert.equal(prepared.exit, 0, prepared.stdout + prepared.stderr);
  assert.equal(f.readState().issues["WNDF-T"].metadata["finalize.pending"].includes("prepared_change_ref"), true);
  const accepted = await f.writeback();
  assert.equal(accepted.exit, 0, accepted.stdout + accepted.stderr);
});

test("D3-B: stale TFS done marker cannot bypass actual parent status", async t => {
  const f = await fixture(t, { preArchived: true, metadata: { "delivery.tfs_written": "true" } });
  const prepared = await f.phase("prepare");
  assert.equal(prepared.exit, 0, prepared.stdout + prepared.stderr);
  const rejected = await f.phase("complete");
  assert.equal(rejected.exit, 3, rejected.stdout + rejected.stderr);
  assert.match(rejected.body.reason, /TFS 父项/);
  assert.notEqual(f.readState().issues["WNDF-T"].status, "done");
  const writeback = await f.writeback();
  assert.equal(writeback.exit, 3, writeback.stdout + writeback.stderr);
  assert.ok(f.readState().issues["WNDF-T"].metadata["finalize.pending"]);
});

test("D3-B: TFS state write failure leaves pending, can resume without archive replay", async t => {
  const f = await fixture(t, { denyTfsStateWrite: true });
  const first = await f.run();
  assert.notEqual(first.exit, 0);
  const state = f.readState().issues["WNDF-T"];
  assert.notEqual(state.status, "done");
  assert.ok(state.metadata["finalize.pending"]);
  assert.equal(state.metadata["delivery.summary_comment_id"], undefined);
  assert.equal(f.readOps().filter(v => v === "archive").length, 1);
  f.tfsControl.denyStateWrite = false;
  const second = await f.run();
  assert.equal(second.exit, 0, second.stdout + second.stderr);
  assert.equal(f.readState().issues["WNDF-T"].status, "done");
  assert.equal(f.readOps().filter(v => v === "archive").length, 1);
});
