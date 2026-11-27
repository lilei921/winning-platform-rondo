// workitem sync 正文投影测试：按工作项类型选主内容字段（Bug → ReproSteps/Symptom），
// 主字段之外已知内容字段非空追加；乱码统计覆盖全部渲染字段；正文内嵌 TFS attachment 图片
// 并入附件物化管线（与 AttachedFile 按 URL 去重），外链图片只留占位。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK_MULTICA = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const MOCK_TFS = fileURLToPath(new URL("./mock-tfs.cjs", import.meta.url));
const FFFD = String.fromCharCode(0xfffd);

function baseWi(over = {}) {
  return {
    id: 263397,
    type: "Bug",
    title: "流程名称不能相同",
    url: "http://tfs/wi/263397",
    state: "已建议",
    changedDate: "2026-11-10T02:29:50.17Z",
    fields: {},
    attachments: [],
    ...over,
  };
}

/** 跑一轮 reconcile（create 路径），返回 { exit, body, issue }：issue 为 mock 状态中新建的 Issue。 */
function runCreate(t, workItems) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-tfs-reconcile-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const queryFile = join(dir, "query.json");
  writeFileSync(queryFile, JSON.stringify(workItems));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({
    agents_list: [{ id: "agent-wayfinder", name: "Wayfinder Agent" }],
  }));
  chmodSync(MOCK_MULTICA, 0o755);
  const config = join(dir, "sync-config.json");
  writeFileSync(config, JSON.stringify({
    tfs: { query_command: [process.execPath, MOCK_TFS, "workitem", "query"] },
    multica: { cli: MOCK_MULTICA, workspace_id: "ws-test", project: "proj-1", intake_agent: "Wayfinder Agent" },
    sync: {},
  }));

  const r = spawnSync(process.execPath, [CLI, "workitem", "sync", "--config", config], {
    encoding: "utf8",
    env: { ...process.env, MOCK_STATE: statePath, MOCK_TFS_QUERY_FILE: queryFile },
  });
  assert.equal(r.error, undefined, r.error?.message);
  let body;
  try { body = JSON.parse(r.stdout); } catch { assert.fail("CLI 未输出 JSON: " + r.stdout + "\n" + r.stderr); }
  assert.equal(r.status, 0, `reconcile 失败: ${r.stderr}\n${r.stdout}`);
  assert.equal(body.created.length, 1, "应恰好创建 1 个 Issue: " + r.stdout);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const issues = Object.values(state.issues || {});
  assert.equal(issues.length, 1);
  return { body, issue: issues[0], statePath, queryFile, config };
}


test("无附件 Issue 创建时保留真实 Markdown 换行；旧版转义正文重跑仅修复一次", (t) => {
  const { issue, statePath, queryFile, config } = runCreate(t, [baseWi({
    type: "需求",
    attachments: [],
    fields: { "System.Description": "<p>第一行</p><p>第二行</p>" },
  })]);
  const expected = issue.description;
  assert.ok(expected.startsWith("## Source Requirement（TFS 原始事实）\n\n- TFS Work Item:"), expected);
  assert.ok(expected.includes("## 需求详细信息（System.Description）\n\n第一行\n第二行"), expected);

  // 旧版 create 使用字面 \n，且已记录 tfs.body_at，不能等待 TFS 字段变更才修复。
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.issues[issue.identifier].description = expected.replace(/\n/g, "\\n");
  writeFileSync(statePath, JSON.stringify(state));

  const syncAgain = () => {
    const r = spawnSync(process.execPath, [CLI, "workitem", "sync", "--config", config], {
      encoding: "utf8",
      env: { ...process.env, MOCK_STATE: statePath, MOCK_TFS_QUERY_FILE: queryFile },
    });
    assert.equal(r.status, 0, r.stderr + "\n" + r.stdout);
    return JSON.parse(r.stdout);
  };

  const repaired = syncAgain();
  assert.equal(repaired.updated.length, 1);
  assert.equal(repaired.updated[0].body_refreshed, true);
  assert.equal(JSON.parse(readFileSync(statePath, "utf8")).issues[issue.identifier].description, expected);

  const noChange = syncAgain();
  assert.equal(noChange.updated.length, 0);
  assert.equal(noChange.skipped.length, 1);
});

test("Bug：主字段为 ReproSteps/Symptom，Description 为空不渲染", (t) => {
  const { issue } = runCreate(t, [baseWi({
    fields: {
      "System.Description": "",
      "Microsoft.VSTS.TCM.ReproSteps": "<p>【环境信息】 url：http://172.17.0.56:8888</p>",
      "Microsoft.VSTS.CMMI.Symptom": "<b>【期望结果】</b>",
    },
  })]);
  const d = issue.description;
  assert.ok(d.includes("## 重现步骤（Microsoft.VSTS.TCM.ReproSteps）\n\n【环境信息】 url：http://172.17.0.56:8888"), d);
  assert.ok(d.includes("## 症状（Microsoft.VSTS.CMMI.Symptom）\n\n【期望结果】"), d);
  assert.ok(!d.includes("## 需求详细信息（System.Description）"), d);
  assert.ok(!d.includes("## 需求分析（Winning.Demand.Analysis）"), d);
  // 初始化收口：pending 清除、正文书签记录 changedDate、Owner 保持 Wayfinder
  assert.equal(issue.metadata["tfs.intake_pending"], undefined);
  assert.equal(issue.metadata["tfs.body_at"], "2026-11-10T02:29:50.17Z");
  assert.equal(issue.assignee_id, "agent-wayfinder");
});

test("需求：保持 Description + 需求分析两小节（回归）", (t) => {
  const { issue } = runCreate(t, [baseWi({
    type: "需求",
    fields: {
      "System.Description": "<p>需求内容甲</p>",
      "Winning.Demand.Analysis": "<p>分析内容乙</p>",
    },
  })]);
  const d = issue.description;
  assert.ok(d.includes("## 需求详细信息（System.Description）\n\n需求内容甲"), d);
  assert.ok(d.includes("## 需求分析（Winning.Demand.Analysis）\n\n分析内容乙"), d);
  assert.ok(!d.includes("## 重现步骤"), d);
});

test("Bug：主字段之外 Description 非空时兜底追加小节", (t) => {
  const { issue } = runCreate(t, [baseWi({
    fields: {
      "System.Description": "<p>额外描述</p>",
      "Microsoft.VSTS.TCM.ReproSteps": "<p>步骤一</p>",
    },
  })]);
  const d = issue.description;
  assert.ok(d.includes("## 重现步骤（Microsoft.VSTS.TCM.ReproSteps）\n\n步骤一"), d);
  // 症状是 Bug 主字段：缺失也渲染空占位小节
  assert.ok(d.includes("## 症状（Microsoft.VSTS.CMMI.Symptom）\n\n（空）"), d);
  assert.ok(d.includes("## 需求详细信息（System.Description）\n\n额外描述"), d);
  // 主字段在前，兜底小节在后
  assert.ok(d.indexOf("## 重现步骤") < d.indexOf("## 需求详细信息"), d);
});

test("乱码统计覆盖 Bug 主字段（ReproSteps 含 U+FFFD）", (t) => {
  const { issue } = runCreate(t, [baseWi({
    fields: {
      "Microsoft.VSTS.TCM.ReproSteps": `<p>乱码${FFFD}测试</p>`,
    },
  })]);
  assert.ok(issue.description.includes("源字段含 1 处 U+FFFD"), issue.description);
});

test("正文内嵌 TFS 图片并入附件物化（与 AttachedFile 去重），外链图片仅占位", (t) => {
  // 查询串形态（生产实测）：GUID 在 FileNameGUID 参数，无 /{guid} 路径段
  const tfsImgQuery = "http://tfs.local/tfs/c/_apis/wit/attachments?FileNameGUID=11111111-2222-3333-4444-555555555555&FileName=shot.png";
  // 路径段形态：GUID 在路径中
  const tfsImgPath = "http://tfs.local/tfs/c/_apis/wit/attachments/66666666-7777-8888-9999-000000000000?fileName=flow.png";
  const { issue } = runCreate(t, [baseWi({
    fields: {
      "Microsoft.VSTS.TCM.ReproSteps":
        `<p>步骤一</p><img src="${tfsImgQuery}"><p>步骤二</p><img src="${tfsImgPath}"><p>步骤三</p><img src="http://example.com/x.png">`,
    },
    // 查询串形态的图片同时出现在 AttachedFile：按 URL 去重，只物化一次
    attachments: [{ url: tfsImgQuery, name: "shot.png", comment: null }],
  })]);
  const d = issue.description;
  // 正文占位：TFS 图指向附件段，外链图保留原 URL
  assert.equal(d.split("[图片: 见附件段]").length - 1, 2, d);
  assert.ok(d.includes("[图片: http://example.com/x.png]"), d);
  // 附件段：恰好两条映射行（去重生效），且均已物化出 Multica 副本
  assert.equal(d.split(" — [TFS 原始](").length - 1, 2, d);
  assert.ok(
    d.includes(`- shot.png — [TFS 原始](${tfsImgQuery}) / [Multica 副本](https://mock-multica/files/shot.png)`),
    d,
  );
  assert.ok(
    d.includes(`- flow.png — [TFS 原始](${tfsImgPath}) / [Multica 副本](https://mock-multica/files/flow.png)（备注：（正文内嵌））`),
    d,
  );
  // 外链图片未被物化（不出现在附件段）
  assert.equal(d.split("example.com").length - 1, 1, d);
});
