#!/usr/bin/env node
// 桩 multica CLI（向后兼容扩展版，rll5-replay-remediation-plan M1）。
//
// 基础（legacy，与旧版逐字节一致）：issue get / project resource list /
//   issue metadata set|list / issue status —— state 无 issues/comments 键时走此形状。
// 扩展：多 Issue（st.issues[KEY]，按 identifier 或 id 解析）、issue comment list --full /
//   issue comment add --content-stdin / issue create（--description-stdin 或 --description，
//   后者按 CLI 约定将字面 \n 反转义）/ issue assign / agent get。
// tfs reconcile 测试扩展：agent list（st.agents_list=[{id,name}]）/ issue list
//   （--metadata 的 rondo CSV 形式 `"key=""value"""` 过滤）/ issue update
//   （--description-file 重写正文；--attachment 追加 !file[name](mock-url) 引用）。
// 故障注入（M3 重试/写回读测试用；未设置 MOCK_FAIL_MODE 时零开销）：
//   MOCK_FAIL_MODE=empty_stdout  —— rc=0 且无输出（模拟空 stdout）
//   MOCK_FAIL_MODE=tls_stderr    —— rc=1 + stderr TLS 文本，状态不变（模拟传输层失败）
//   MOCK_FAIL_MODE=flaky_write   —— 写操作：先落状态再 rc=1 + TLS 文本（模拟"写成功但响应丢失"）
//   MOCK_FAIL_MODE=write_fail    —— 写操作：不落状态直接 rc=1 + TLS 文本（真失败；读不受影响）
//   MOCK_FAIL_STATE=<文件>       —— 文件内容为剩余故障次数，每次注入递减（跨进程计数）
// 状态经 MOCK_STATE 文件持久化（写后 issue get / comment list 回读可见）；MOCK_ROOT_REPO 指定根仓。
const fs = require("fs");
const a = process.argv.slice(2);
// Handoff 的无配置测试仅验证原生 Task 身份环境已传入；认证仍由真实 Multica CLI 负责。
if (process.env.MOCK_REQUIRE_TASK_RUNTIME === "1" &&
    (!process.env.MULTICA_TOKEN?.startsWith("mat_") || !process.env.MULTICA_TASK_ID)) {
  process.stderr.write("mock-multica: missing Task Token or Task ID\n");
  process.exit(3);
}
// 配置环境必须贯穿每次调用；测试未设置期望时仍兼容默认环境。
for (const [flag, envKey] of [["--profile", "MOCK_EXPECT_PROFILE"], ["--server-url", "MOCK_EXPECT_SERVER"]]) {
  if (process.env[envKey] && a[a.indexOf(flag) + 1] !== process.env[envKey]) {
    throw new Error(`环境参数缺失或错误: ${flag}`);
  }
}
while (["--profile", "--server-url"].includes(a[0])) a.splice(0, 2);
// 专用同步回归留存每次命令，以验证没有重复创建或上传。
if (process.env.MOCK_SYNC_CALLS_FILE) fs.appendFileSync(process.env.MOCK_SYNC_CALLS_FILE, JSON.stringify(a) + "\n");
const sp = process.env.MOCK_STATE;
const st = sp && fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, "utf8")) : { metadata: {} };

function save() { fs.writeFileSync(sp, JSON.stringify(st)); }
function flag(name) { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; }

// --- 故障注入 ---
function failLeft() {
  const fp = process.env.MOCK_FAIL_STATE;
  if (!process.env.MOCK_FAIL_MODE || !fp || !fs.existsSync(fp)) return 0;
  const n = parseInt(fs.readFileSync(fp, "utf8"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function consumeFail() { fs.writeFileSync(process.env.MOCK_FAIL_STATE, String(failLeft() - 1)); }
// 读侧：输出前调用；返回 true 表示本次已被故障接管（进程已退出则不会返回）
function injectReadFail() {
  if (failLeft() <= 0) return;
  const mode = process.env.MOCK_FAIL_MODE;
  if (mode !== "empty_stdout" && mode !== "tls_stderr") return;
  consumeFail();
  if (mode === "empty_stdout") process.exit(0);
  process.stderr.write("TLS handshake timeout\n");
  process.exit(1);
}
// 写侧：状态已落盘后调用（flaky_write 的核心语义：副作用已发生，响应丢失）
function injectWriteFail() {
  if (failLeft() <= 0) return;
  consumeFail();
  const mode = process.env.MOCK_FAIL_MODE;
  if (mode === "empty_stdout") process.exit(0);
  process.stderr.write("TLS handshake timeout\n");
  process.exit(1);
}
// 写侧（真失败）：在任何状态变更前调用；仅 write_fail 模式生效——副作用未发生
function injectWriteFailClean() {
  if (process.env.MOCK_FAIL_MODE !== "write_fail") return;
  if (failLeft() <= 0) return;
  consumeFail();
  process.stderr.write("TLS handshake timeout\n");
  process.exit(1);
}

// 多 Issue 解析：st.issues 存在 → 按 identifier/id 命中；否则回落 legacy 单 Issue 形状
function findIssue(ref) {
  if (st.issues) {
    for (const k of Object.keys(st.issues)) {
      const it = st.issues[k];
      if (it.identifier === ref || it.id === ref) return it;
    }
    return null;
  }
  return { id: "issue-1", identifier: "WNDF-T", project_id: "project1", status: st.status || "in_progress", metadata: st.metadata || {} };
}

if (a[0] === "issue" && a[1] === "get") {
  if (process.env.MOCK_STATUS_ON_ISSUE_READ || process.env.MOCK_METADATA_ON_ISSUE_READ) {
    st.issue_reads = (st.issue_reads || 0) + 1;
    if (st.issue_reads === Number(process.env.MOCK_STATUS_ON_ISSUE_READ)) st.status = "blocked";
    if (st.issue_reads === Number(process.env.MOCK_METADATA_ON_ISSUE_READ)) {
      // 模拟当前 Issue 的同一快照中发生并发 Facts/Source 更新。
      const patch = JSON.parse(process.env.MOCK_ISSUE_METADATA_PATCH);
      const target = st.issues ? findIssue(a[2]) : st;
      target.metadata = { ...target.metadata, ...patch };
    }
    save();
  }
  injectReadFail();
  const it = findIssue(a[2]);
  if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[2]}\n`); process.exit(3); }
  process.stdout.write(JSON.stringify({
    id: it.id, identifier: it.identifier, project_id: it.project_id,
    status: it.status, metadata: it.metadata || {},
    ...(it.parent_issue_id !== undefined ? { parent_issue_id: it.parent_issue_id } : {}),
    ...(it.assignee_id !== undefined ? { assignee_id: it.assignee_id } : {}),
    ...(it.assignee_type !== undefined ? { assignee_type: it.assignee_type } : {}),
  }));
} else if (a[0] === "project" && a[1] === "resource") {
  injectReadFail();
  process.stdout.write(JSON.stringify(st.project_resources ?? [
    { resource_type: "local_directory", resource_ref: { execution_mode: "in_place", local_path: process.env.MOCK_ROOT_REPO } },
  ]));
} else if (a[0] === "issue" && a[1] === "metadata" && a[2] === "set") {
  injectWriteFailClean();
  const k = flag("--key");
  const v = flag("--value");
  // 保留 rondo 的 Stage 写失败回归注入。
  if (process.env.MOCK_FAIL_METADATA_KEY === k) {
    process.stderr.write("mock-multica: injected metadata set failure: " + k + "\n");
    process.exit(1);
  }
  if (st.issues) {
    const it = findIssue(a[3]);
    if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[3]}\n`); process.exit(3); }
    it.metadata = it.metadata || {};
    it.metadata[k] = v;
  } else {
    st.metadata = st.metadata || {};
    st.metadata[k] = v;
  }
  save();
  injectWriteFail();
  process.stdout.write(JSON.stringify({ ok: true }));
} else if (a[0] === "issue" && a[1] === "metadata" && a[2] === "list") {
  injectReadFail();
  // 模拟 complete 推送/远端核验期间另一流程发布了来源，不能覆盖该新事实。
  if (process.env.MOCK_DRIFT_ANALYSIS_SOURCE) {
    st.metadata_reads = (st.metadata_reads || 0) + 1;
    if (st.metadata_reads === 2) st.metadata["analysis.source"] = process.env.MOCK_DRIFT_ANALYSIS_SOURCE;
    save();
  }
  const it = findIssue(a[3]);
  process.stdout.write(JSON.stringify((it && it.metadata) || {}));
} else if (a[0] === "issue" && a[1] === "metadata" && a[2] === "delete") {
  // issue metadata delete <issue-id> --key <k>
  injectWriteFailClean();
  const k = flag("--key");
  if (st.issues) {
    const it = findIssue(a[3]);
    if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[3]}\n`); process.exit(3); }
    if (it.metadata) delete it.metadata[k];
  } else {
    if (st.metadata) delete st.metadata[k];
  }
  save();
  injectWriteFail();
  process.stdout.write(JSON.stringify({ ok: true }));
} else if (a[0] === "issue" && a[1] === "status") {
  if (process.env.MOCK_FAIL_STATUS) { process.stderr.write("injected status failure\n"); process.exit(1); }
  // issue status <issue-id> <status> [--no-start] ...（a[2]=issue-id，a[3]=status）
  injectWriteFailClean();
  if (st.issues) {
    const it = findIssue(a[2]);
    if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[2]}\n`); process.exit(3); }
    it.status = a[3];
    save();
    injectWriteFail();
    process.stdout.write(JSON.stringify({ ok: true, status: it.status }));
  } else {
    st.status = a[3];
    save();
    if (process.env.MOCK_STATUS_RESPONSE_LOST) { process.stderr.write("status response lost\n"); process.exit(1); }
    injectWriteFail();
    process.stdout.write(JSON.stringify({ ok: true, status: st.status }));
  }
} else if (a[0] === "issue" && a[1] === "comment" && a[2] === "list") {
  // issue comment list <issue-ref> --full → [{id, content}, ...]
  injectReadFail();
  const it = findIssue(a[3]);
  const key = it ? it.id : a[3];
  process.stdout.write(JSON.stringify((st.comments || {})[key] || []));
} else if (a[0] === "issue" && a[1] === "comment" && a[2] === "add") {
  // issue comment add <issue-id> --content-stdin | --content-file <f> [--allow-external-file] → {id}
  injectWriteFailClean();
  const contentFile = flag("--content-file");
  const content = contentFile ? fs.readFileSync(contentFile, "utf8") : fs.readFileSync(0, "utf8");
  const it = findIssue(a[3]);
  if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[3]}\n`); process.exit(3); }
  st.comments = st.comments || {};
  st.comments[it.id] = st.comments[it.id] || [];
  st.comment_seq = (st.comment_seq || 0) + 1;
  const cid = `comment-${st.comment_seq}`;
  st.comments[it.id].push({ id: cid, content });
  save();
  if (process.env.OPS_LOG) fs.appendFileSync(process.env.OPS_LOG, `multica-comment ${it.id}\n`);
  injectWriteFail();
  process.stdout.write(JSON.stringify({ id: cid }));
} else if (a[0] === "issue" && a[1] === "create") {
  // issue create --project <p> --parent <pid> --status <s> --title <t> --description-stdin | --description <text> → IssueRecord
  injectWriteFailClean();
  const descFlag = flag("--description");
  // --description 透传原始文本，不能替 CLI 将字面 \\n 反转义。
  const description = descFlag !== undefined ? descFlag : fs.readFileSync(0, "utf8");
  st.issues = st.issues || {};
  st.issue_seq = (st.issue_seq || 0) + 1;
  const id = `issue-sub-${st.issue_seq}`;
  const identifier = `WNDF-T-${st.issue_seq}`;
  // --assignee <name> 按 st.agents_list 解析为 id（reconcile 的准入 Owner 回读依赖该字段）
  const assigneeName = flag("--assignee");
  const agent = assigneeName ? (st.agents_list || []).find((g) => g.name === assigneeName) : undefined;
  const it = {
    id, identifier,
    project_id: flag("--project"),
    parent_issue_id: flag("--parent"),
    status: flag("--status") || "backlog",
    title: flag("--title"),
    description,
    metadata: {},
    ...(agent ? { assignee_id: agent.id } : {}),
  };
  st.issues[identifier] = it;
  save();
  injectWriteFail();
  process.stdout.write(JSON.stringify(it));
} else if (a[0] === "issue" && a[1] === "list") {
  // issue list --project <p> [--metadata `"key=""value"""`（rondo CSV 形式）] → IssueRecord[]
  injectReadFail();
  const metaFilter = flag("--metadata");
  let list = Object.values(st.issues || {});
  if (metaFilter) {
    const m = metaFilter.match(/^"?([\w.-]+)="{2,3}(.*?)"{2,3}$/);
    if (!m) { process.stderr.write("mock-multica: 无法解析 --metadata 过滤: " + metaFilter + "\n"); process.exit(1); }
    list = list.filter((it) => String((it.metadata || {})[m[1]]) === m[2]);
  }
  process.stdout.write(JSON.stringify(list));
} else if (a[0] === "issue" && a[1] === "update") {
  // issue update <id> [--description-file <f>] [--attachment <path>] [--no-start --allow-external-file] → IssueRecord
  injectWriteFailClean();
  const it = findIssue(a[2]);
  if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[2]}\n`); process.exit(3); }
  const descFile = flag("--description-file");
  if (descFile) it.description = fs.readFileSync(descFile, "utf8");
  const att = flag("--attachment");
  if (a.includes("--attachment") && process.env.MOCK_UPLOAD_RESULT_UNKNOWN === "1") {
    process.stderr.write("mock upload result unknown\n");
    process.exit(3);
  }
  if (att) {
    const name = require("path").basename(att);
    // 平台行为（2026-11-10 实测）：上传成功后在正文尾部追加 ![name](url) 图片语法引用
    // 同名文件也可能是不同附件；专用回归模拟平台每次上传生成独立身份。
    if (process.env.MOCK_UNIQUE_ATTACHMENT_URL === "1") st.attachment_seq = (st.attachment_seq || 0) + 1;
    const suffix = process.env.MOCK_UNIQUE_ATTACHMENT_URL === "1" ? `?id=${st.attachment_seq}` : "";
    it.description = (it.description || "") + `\n![${name}](https://mock-multica/files/${encodeURIComponent(name)}${suffix})`;
  }
  const nextStatus = flag("--status");
  const nextAssignee = flag("--assignee-id");
  if (nextStatus) it.status = nextStatus;
  if (nextAssignee) {
    const squad = (st.squads_list || []).find(s => s.id === nextAssignee);
    it.assignee_id = nextAssignee;
    it.assignee_type = squad ? "squad" : "agent";
    st.handoff_update_count = (st.handoff_update_count || 0) + 1;
    if (nextStatus === "todo" && process.env.MOCK_SKIP_HANDOFF_RUN !== "1") {
      st.runs = st.runs || {};
      st.runs[it.id] = st.runs[it.id] || [];
      st.run_seq = (st.run_seq || 0) + 1;
      st.runs[it.id].push({
        id: "run-" + st.run_seq,
        issue_id: it.id,
        agent_id: squad ? squad.leader_id : nextAssignee,
        attribution: { evidence: { kind: "issue_assignment", ref_id: it.id } },
      });
    }
    if (process.env.MOCK_ADVANCE_HANDOFF_STATUS) it.status = process.env.MOCK_ADVANCE_HANDOFF_STATUS;
  }
  save();
  // 模拟附件已落库但响应丢失：保留裸引用，下一轮必须认领而非再次上传。
  if (att && process.env.MOCK_UPLOAD_RESPONSE_LOST === "1") {
    process.stderr.write("mock upload response lost after write\n");
    process.exit(3);
  }
  injectWriteFail();
  process.stdout.write(JSON.stringify(it));
} else if (a[0] === "issue" && a[1] === "runs") {
  injectReadFail();
  const it = findIssue(a[2]);
  if (!it) { process.stderr.write("mock-multica: issue not found\n"); process.exit(3); }
  process.stdout.write(JSON.stringify((st.runs || {})[it.id] || []));
} else if (a[0] === "issue" && a[1] === "assign") {
  // issue assign <issue-id> --to-id <agent> --no-start
  injectWriteFailClean();
  const it = findIssue(a[2]);
  if (!it) { process.stderr.write(`mock-multica: issue 不存在: ${a[2]}\n`); process.exit(3); }
  it.assignee_id = flag("--to-id");
  save();
  injectWriteFail();
  process.stdout.write(JSON.stringify({ ok: true }));
} else if (a[0] === "squad" && a[1] === "list") {
  injectReadFail();
  process.stdout.write(JSON.stringify(st.squads_list || []));
} else if (a[0] === "repo" && a[1] === "checkout" && st.repo_checkout) {
  const checkout = st.repo_checkout;
  if (a[2] !== checkout.url || flag("--ref") !== checkout.ref) throw new Error("Unexpected checkout URL/ref");
  process.stdout.write(checkout.path + "\nKept the existing checkout (branch: " + checkout.branch + ")\n");
} else if (a[0] === "agent" && a[1] === "list") {
  // agent list → [{id, name}, ...]（reconcile 解析唯一准入 Agent）
  injectReadFail();
  process.stdout.write(JSON.stringify(st.agents_list || []));
} else if (a[0] === "agent" && a[1] === "get") {
  injectReadFail();
  const ag = (st.agents || {})[a[2]];
  if (!ag) { process.stderr.write(`mock-multica: agent 不存在: ${a[2]}\n`); process.exit(3); }
  process.stdout.write(JSON.stringify({ id: a[2], name: ag.name }));
} else {
  process.stderr.write("mock-multica: unexpected args: " + a.join(" ") + "\n");
  process.exit(1);
}
