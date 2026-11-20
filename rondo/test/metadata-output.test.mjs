import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const spawnModule = new URL("../dist/clients/spawn.js", import.meta.url).href;
const payload = JSON.stringify({ candidate_commit: "a".repeat(40), summary: "实际验证记录".repeat(2000) });

// 通过真实子进程验证：缩短返回给 Agent 的日志，不能缩短发送给 CLI 的证据。
function run(t, { trace = false, stdin = false, equals = false, failure = false, metadata = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-metadata-output-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stub = join(dir, "stub.cjs"), runner = join(dir, "runner.mjs"), input = join(dir, "input.json");
  writeFileSync(stub, `
    const fs = require('node:fs');
    if (process.env.TEST_FAILURE === '1') { console.error('permission denied'); process.exit(3); }
    const args = process.argv.slice(2);
    const i = args.indexOf('--value');
    const value = i >= 0 ? args[i + 1] : args.find(x => x.startsWith('--value=')).slice(8);
    process.stdout.write(JSON.stringify({ value, stdin: process.env.TEST_STDIN === '1' ? fs.readFileSync(0, 'utf8') : '' }));
  `);
  writeFileSync(input, JSON.stringify({ payload, equals, metadata }));
  writeFileSync(runner, `
    import { readFileSync } from 'node:fs';
    import { runJson, runJsonStdin } from ${JSON.stringify(spawnModule)};
    const {payload, equals, metadata} = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    const cmd = [process.execPath, process.argv[2], ...(metadata ? ['issue', 'metadata', 'set', 'issue-1'] : ['other']),
      '--key', 'bug.delivery', ...(equals ? ['--value=' + payload] : ['--value', payload]), '--output', 'json'];
    try {
      const out = process.env.TEST_STDIN === '1' ? runJsonStdin(cmd, '写入测试', '原始输入') : runJson(cmd, '写入测试');
      process.stdout.write(JSON.stringify(out));
    } catch (e) {
      process.stdout.write(JSON.stringify({name: e.name, message: e.message}));
      process.exitCode = 3;
    }
  `);
  return spawnSync(process.execPath, [runner, stub, input], {
    encoding: "utf8", env: { ...process.env, SKILL_FLOW_TRACE: trace ? "1" : "",
      TEST_STDIN: stdin ? "1" : "", TEST_FAILURE: failure ? "1" : "" },
  });
}

for (const options of [{}, { trace: true }, { stdin: true, equals: true, trace: true }]) {
  test(`Metadata 原样传入并返回；日志不展开正文 ${JSON.stringify(options)}`, t => {
    const r = run(t, options);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { value: payload, stdin: options.stdin ? "原始输入" : "" });
    assert.match(r.stderr, /issue metadata set issue-1/);
    assert.match(r.stderr, /bug.delivery/);
    assert.ok(!r.stderr.includes("实际验证记录"));
    assert.ok(r.stderr.length < payload.length / 5, "日志应与正文大小解耦");
  });
}

test("Metadata 写入 UNKNOWN 保留错误原因，不把日志缩减当作成功", t => {
  const r = run(t, { failure: true, trace: true });
  assert.equal(r.status, 3);
  assert.match(JSON.parse(r.stdout).message, /UNKNOWN: permission denied/);
  assert.ok(!r.stderr.includes("实际验证记录"));
});

test("非 Metadata 命令的日志和执行参数保持原样", t => {
  const r = run(t, { metadata: false });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).value, payload);
  assert.ok(r.stderr.includes(payload));
});
