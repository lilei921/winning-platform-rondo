// 附件同步回归：真实 CLI 子进程 + 持久化桩，验证失败隔离和跨轮幂等。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./mock-sync-entry.mjs", import.meta.url));
const MOCK_MULTICA = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));
const GUID = "015244e4-6152-40db-a6b9-e2e7794ac865";
const source = `http://tfs.local/tfs/c/wrong-project/_apis/wit/attachments?FileNameGUID=${GUID}&FileName=shot.png`;
const canonical = `http://tfs.local/tfs/c/_apis/wit/attachments/${GUID}?fileName=shot.png`;

function wi(id, attachments = []) {
  return { id, type: "Bug", title: `Bug ${id}`, url: `http://tfs.local/tfs/c/_workitems/edit/${id}`,
    state: "已建议", changedDate: "2026-11-14T05:28:21.317Z", fields: {}, attachments };
}

function fixture(t, items) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-attachment-recovery-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const query = join(dir, "query.json"), state = join(dir, "state.json"), calls = join(dir, "calls.jsonl");
  writeFileSync(query, JSON.stringify(items));
  writeFileSync(state, JSON.stringify({ agents_list: [{ id: "wayfinder", name: "Wayfinder Agent" }] }));
  chmodSync(MOCK_MULTICA, 0o755);
  return {
    dir,
    setItems(value) { writeFileSync(query, JSON.stringify(value)); },
    state() { return JSON.parse(readFileSync(state, "utf8")); },
    setState(value) { writeFileSync(state, JSON.stringify(value)); },
    run(env = {}) {
      writeFileSync(calls, "");
      const r = spawnSync(process.execPath, [CLI, "workitem", "sync", "--wiql", "SELECT [System.Id] FROM workitems"], {
        encoding: "utf8", env: { ...process.env, MULTICA_WORKSPACE_ID: "ws-test", MULTICA_SERVER_URL: "https://mock-multica", MULTICA_CLI_PATH: MOCK_MULTICA, RONDO_PROJECT_TITLE: "Sync Project", MOCK_STATE: state, MOCK_TFS_QUERY_FILE: query, MOCK_SYNC_CALLS_FILE: calls, ...env },
      });
      assert.equal(r.error, undefined);
      let result;
      try { result = JSON.parse(r.stdout); } catch { assert.fail(`非 JSON: ${r.stdout}\n${r.stderr}`); }
      return { exit: r.status, result, stderr: r.stderr,
        calls: readFileSync(calls, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line)) };
    },
  };
}
const uploads = r => r.calls.filter(a => a.includes("--attachment"));
const creates = r => r.calls.filter(a => a[0] === "issue" && a[1] === "create");

// 准入清单首读失败必须自行恢复，不能让只读瞬断阻断整轮同步或重复创建。
for (const mode of ["tls_stderr", "empty_stdout"]) {
  test(`准入 Agent 查询瞬断 ${mode}：退避恢复且只创建一个 Issue`, t => {
    const f = fixture(t, [wi(265136)]);
    const failure = join(f.dir, "remaining-failures.txt");
    writeFileSync(failure, "1");
    const first = f.run({ MOCK_FAIL_MODE: mode, MOCK_FAIL_STATE: failure });
    assert.equal(first.exit, 0, first.stderr);
    assert.equal(first.calls.filter(a => a[0] === "agent" && a[1] === "list").length, 2);
    assert.equal(creates(first).length, 1);
    assert.equal(first.result.created.length, 1);
    assert.equal(Object.keys(f.state().issues).length, 1);
    const again = f.run();
    assert.equal(again.exit, 0, again.stderr);
    assert.equal(creates(again).length, 0);
    assert.equal(again.result.skipped.length, 1);
  });
}

test("404 + error JSON + exit 2：禁止上传、记录真实下载原因并继续下一项；恢复重跑不重复创建上传", t => {
  const first = wi(264839, [{ url: source, name: "shot.png" }]);
  const f = fixture(t, [first, wi(264840)]);
  const failed = f.run({ MOCK_TFS_DOWNLOAD_RESPONSES: JSON.stringify({ [source]: { exit: 2, body: { error: "HTTP 404: 附件不存在或无权限" } } }) });
  assert.equal(failed.exit, 2, failed.stderr);
  assert.equal(uploads(failed).length, 0);
  assert.equal(failed.result.created.length, 1);
  assert.equal(failed.result.created[0].tfs_id, "264840");
  assert.equal(failed.result.failed.length, 1);
  assert.equal(failed.result.failed[0].stage, "download");
  assert.equal(failed.result.failed[0].source_url, source);
  assert.ok(failed.result.failed[0].issue_id);
  assert.match(failed.result.failed[0].error, /404/);
  const pending = Object.values(f.state().issues).find(i => i.metadata["tfs.id"] === "264839");
  assert.equal(pending.metadata["tfs.intake_pending"], "true");

  const recovered = f.run();
  assert.equal(recovered.exit, 0, recovered.stderr);
  assert.equal(creates(recovered).length, 0);
  assert.equal(uploads(recovered).length, 1);
  assert.equal(Object.keys(f.state().issues).length, 2);
  assert.equal(Object.values(f.state().issues).find(i => i.id === pending.id).metadata["tfs.intake_pending"], undefined);
  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(creates(again).length, 0);
  assert.equal(uploads(again).length, 0);
  assert.equal(again.result.skipped.length, 2);
});

for (const body of [{ error: "下载失败" }, { path: "missing-file.png", name: "shot.png", size: 123 }]) {
  test(`exit 0 但下载契约无效时禁止上传：${JSON.stringify(body)}`, t => {
    const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png" }])]);
    const r = f.run({ MOCK_TFS_DOWNLOAD_RESPONSES: JSON.stringify({ [source]: { exit: 0, body } }) });
    assert.equal(r.exit, 2, r.stderr);
    assert.equal(uploads(r).length, 0);
    assert.equal(r.result.failed[0].stage, "download");
  });
}

test("下载产物大小与成功响应不符时禁止上传", t => {
  const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png" }])]);
  const path = join(f.dir, "partial.bin");
  writeFileSync(path, "partial");
  const r = f.run({ MOCK_TFS_DOWNLOAD_RESPONSES: JSON.stringify({ [source]: { exit: 0, body: { path, name: "shot.png", size: 99 } } }) });
  assert.equal(r.exit, 2, r.stderr);
  assert.equal(uploads(r).length, 0);
  assert.match(r.result.failed[0].error, /大小/);
});

test("附件 A 已上传、B 下载失败：下轮认领 A 裸引用仅上传 B，再下轮零写入", t => {
  const secondUrl = canonical.replace(GUID, "11111111-2222-3333-4444-555555555555").replace("shot.png", "second.png");
  const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png" }, { url: secondUrl, name: "second.png" }])]);
  const failed = f.run({ MOCK_TFS_DOWNLOAD_RESPONSES: JSON.stringify({ [secondUrl]: { exit: 2, body: { error: "HTTP 404" } } }) });
  assert.equal(failed.exit, 2, failed.stderr);
  assert.equal(uploads(failed).length, 1);
  const resumed = f.run();
  assert.equal(resumed.exit, 0, resumed.stderr);
  assert.equal(creates(resumed).length, 0);
  assert.equal(uploads(resumed).length, 1);
  assert.match(uploads(resumed)[0].join(" "), /second\.png/);
  assert.equal(Object.keys(f.state().issues).length, 1);
  assert.equal(Object.values(f.state().issues)[0].description.split("[Multica 副本]").length - 1, 2);
  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(creates(again).length, 0);
  assert.equal(uploads(again).length, 0);
});

test("同 collection+GUID 的内嵌图与附件合并；项目路径和参数变化不重复上传，跨 collection 不合并", t => {
  const first = wi(264839, [{ url: canonical, name: "shot.png" }]);
  first.fields = { "Microsoft.VSTS.TCM.ReproSteps": `<img src="${source.replaceAll("&", "&amp;")}">` };
  const f = fixture(t, [first]);
  const a = f.run();
  assert.equal(a.exit, 0, a.stderr);
  assert.equal(uploads(a).length, 1);
  const changed = wi(264839, [{ url: source.replace("wrong-project", "correct-project"), name: "shot.png" }]);
  f.setItems([changed]);
  const b = f.run();
  assert.equal(b.exit, 0, b.stderr);
  assert.equal(uploads(b).length, 0);
  assert.equal(creates(b).length, 0);
  changed.attachments.push({ url: canonical.replace("/tfs/c/", "/tfs/other/"), name: "other.png" });
  f.setItems([changed]);
  const c = f.run();
  assert.equal(c.exit, 0, c.stderr);
  assert.equal(uploads(c).length, 1);
});

test("上传 UNKNOWN 保留完成项、当前已创建 Issue 和未处理项", t => {
  const f = fixture(t, [wi(1), wi(2, [{ url: source, name: "shot.png" }]), wi(3)]);
  const r = f.run({ MOCK_UPLOAD_RESULT_UNKNOWN: "1" });
  assert.equal(r.exit, 3, r.stderr);
  assert.equal(r.result.result, "UNKNOWN");
  assert.equal(r.result.created.length, 1);
  assert.equal(r.result.created[0].tfs_id, "1");
  assert.equal(r.result.failed[0].tfs_id, "2");
  assert.ok(r.result.failed[0].issue_id);
  assert.deepEqual(r.result.unprocessed.map(i => i.tfs_id), ["3"]);
  assert.equal(Object.keys(f.state().issues).length, 2);
});

test("上传已落库但响应丢失：UNKNOWN 后认领裸引用，后续两轮不重复创建或上传", t => {
  const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png" }])]);
  const lost = f.run({ MOCK_UPLOAD_RESPONSE_LOST: "1" });
  assert.equal(lost.exit, 3, lost.stderr);
  assert.equal(lost.result.result, "UNKNOWN");
  assert.equal(creates(lost).length, 1);
  assert.equal(uploads(lost).length, 1);
  const pending = Object.values(f.state().issues)[0];
  assert.equal(pending.metadata["tfs.intake_pending"], "true");
  assert.match(pending.description, /!\[shot\.png\]\(https:\/\/mock-multica\/files\/shot\.png\)/);
  assert.equal(pending.description.includes("[Multica 副本]"), false);

  const resumed = f.run();
  assert.equal(resumed.exit, 0, resumed.stderr);
  assert.equal(creates(resumed).length, 0);
  assert.equal(uploads(resumed).length, 0);
  const recovered = Object.values(f.state().issues)[0];
  assert.equal(recovered.id, pending.id);
  assert.equal(recovered.metadata["tfs.intake_pending"], undefined);
  assert.equal(recovered.description.split("[Multica 副本]").length - 1, 1);
  assert.equal(Object.keys(f.state().issues).length, 1);

  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(creates(again).length, 0);
  assert.equal(uploads(again).length, 0);
  assert.equal(again.result.skipped.length, 1);
});

test("同一稳定附件身份映射到多个副本时 UNKNOWN，不猜测也不重新上传", t => {
  const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png" }])]);
  assert.equal(f.run().exit, 0);
  const state = f.state(), issue = Object.values(state.issues)[0];
  issue.description += `\n- shot.png — [TFS 原始](${canonical}) / [Multica 副本](https://mock-multica/files/another.png)`;
  f.setState(state);
  const r = f.run();
  assert.equal(r.exit, 3, r.stderr);
  assert.equal(uploads(r).length, 0);
  assert.match(r.result.reason, /附件.*(冲突|多个|不唯一)/);
});

/** 内嵌身份来自实际 HTML；附件 comment 和文件扩展名都不能代替该证据。 */
function imageWi(id = 264839, urls = [source], attachments = []) {
  return { ...wi(id, attachments), fields: {
    "Microsoft.VSTS.TCM.ReproSteps": urls.map(url => `<img src="${url.replaceAll("&", "&amp;")}">`).join("<br>"),
  } };
}
const nativeImages = body => [...body.matchAll(/^!\[[^\n]*\]\((\S+)\)$/gm)].map(m => m[1]);
const bodyWrites = r => r.calls.filter(a => a[0] === "issue" && a[1] === "update" && a.includes("--description-file"));

test("原生图片：新建内嵌图保持可显示的 Markdown，来源映射仍可追溯", t => {
  const f = fixture(t, [imageWi()]);
  const created = f.run();
  assert.equal(created.exit, 0, created.stderr);
  assert.equal(uploads(created).length, 1);
  const body = Object.values(f.state().issues)[0].description;
  assert.ok(body.includes(`[TFS 原始](${source}) / [Multica 副本](https://mock-multica/files/shot.png)`), body);
  assert.deepEqual(nativeImages(body), ["https://mock-multica/files/shot.png"]);
});

test("图片展示迁移：旧正文只有映射时零创建上传补展示，下一轮完全跳过", t => {
  const f = fixture(t, [imageWi()]);
  assert.equal(f.run().exit, 0);
  const old = f.state(), issue = Object.values(old.issues)[0];
  // 模拟 1.2.22 已同步附件但只保留普通链接的正文，来源时间戳与 pending 均已收口。
  issue.description = issue.description.split("\n").filter(line => !/^!\[/.test(line)).join("\n");
  f.setState(old);
  const migrated = f.run();
  assert.equal(migrated.exit, 0, migrated.stderr);
  assert.equal(creates(migrated).length, 0);
  assert.equal(uploads(migrated).length, 0);
  assert.equal(bodyWrites(migrated).length, 1);
  assert.equal(migrated.result.updated[0].body_refreshed, true);
  assert.deepEqual(nativeImages(Object.values(f.state().issues)[0].description), ["https://mock-multica/files/shot.png"]);
  const again = f.run();
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(creates(again).length, 0);
  assert.equal(uploads(again).length, 0);
  assert.equal(bodyWrites(again).length, 0);
  assert.equal(again.result.skipped.length, 1);
});

test("同名新附件：已有图片展示引用不能认领到不同 GUID 的新图", t => {
  const second = canonical.replace(GUID, "11111111-2222-3333-4444-555555555555");
  const f = fixture(t, [imageWi()]);
  const env = { MOCK_UNIQUE_ATTACHMENT_URL: "1" };
  assert.equal(f.run(env).exit, 0);
  // 模拟用户手工补过展示，使此用例也能在旧实现上暴露误认领问题。
  const old = f.state(), issue = Object.values(old.issues)[0];
  const originalCopy = "https://mock-multica/files/shot.png?id=1";
  if (!nativeImages(issue.description).includes(originalCopy)) issue.description += `\n![shot.png](${originalCopy})`;
  f.setState(old);
  f.setItems([imageWi(264839, [source, second])]);
  const added = f.run(env);
  assert.equal(added.exit, 0, added.stderr);
  assert.equal(creates(added).length, 0);
  assert.equal(uploads(added).length, 1);
  const body = Object.values(f.state().issues)[0].description;
  assert.deepEqual(nativeImages(body), [originalCopy, "https://mock-multica/files/shot.png?id=2"]);
  assert.equal(body.split("[Multica 副本]").length - 1, 2);
  const again = f.run(env);
  assert.equal(again.exit, 0, again.stderr);
  assert.equal(uploads(again).length, 0);
  assert.equal(bodyWrites(again).length, 0);
});

test("非内嵌附件：即使扩展名是 png 或 comment 写正文内嵌，也只生成普通附件链接", t => {
  const f = fixture(t, [wi(264839, [{ url: source, name: "shot.png", comment: "（正文内嵌）" }])]);
  const r = f.run();
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(uploads(r).length, 1);
  const body = Object.values(f.state().issues)[0].description;
  assert.ok(body.includes("[Multica 副本]"));
  assert.deepEqual(nativeImages(body), []);
});

test("内嵌多图同身份：关联附件优先保留名称，展示按真实内嵌身份去重", t => {
  const f = fixture(t, [imageWi(264839, [source, canonical, source], [{ url: canonical, name: "relation-name.bin", comment: null }])]);
  const r = f.run();
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(uploads(r).length, 1);
  const body = Object.values(f.state().issues)[0].description;
  assert.deepEqual(nativeImages(body), ["https://mock-multica/files/relation-name.bin"]);
  assert.equal(body.split("[Multica 副本]").length - 1, 1);
});

for (const [label, projects, title] of [
  ["缺少目标 Title", [{id:"proj-1",title:"Sync Project"}], ""],
  ["目标不存在", [{id:"other",title:"Other"}], "Sync Project"],
  ["目标重名", [{id:"p1",title:"Sync Project"},{id:"p2",title:"Sync Project"}], "Sync Project"],
]) test(`Project 解析失败不写入 Issue：${label}`, t => {
  const f = fixture(t, [wi(265136)]);
  f.setState({...f.state(), projects});
  const r = f.run({RONDO_PROJECT_TITLE:title});
  assert.equal(r.exit, 3, r.stderr);
  assert.equal(r.result.result, "UNKNOWN");
  assert.equal(creates(r).length, 0);
  assert.equal(f.state().issues, undefined);
});
test("同一轮仅解析一次 Project，并使用精确匹配的 ID", t => {
  const f = fixture(t, [wi(265136),wi(265137)]);
  f.setState({...f.state(), projects:[{id:"other",title:"Other"},{id:"target",title:"Sync Project"}]});
  const r = f.run();
  assert.equal(r.exit, 0, r.stderr);
  assert.equal(r.calls.filter(a => a[0]==="project" && a[1]==="list").length,1);
  assert.equal(r.result.created.length,2);
  assert.ok(Object.values(f.state().issues).every(i => i.project_id==="target"));
});
