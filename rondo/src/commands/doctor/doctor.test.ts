import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "./doctor.js";
import { selectChecks } from "./checks/registry.js";
import { runProbe } from "./probe.js";

test("必检项未实际完成时不得通过门禁", () => {
  for (const result of ["SKIP", "INFO", "WARN", "FAIL"] as const) {
    assert.equal(aggregate({ require: ["workflow_statuses"] }, [{ name: "workflow_statuses", level: "WARN", result, detail: "fixture" }]).exitCode, 2);
  }
  assert.equal(aggregate({}, [{ name: "offline", level: "WARN", result: "WARN", detail: "fixture" }]).exitCode, 0);
});

test("单选版本一致性检查时自动包含版本探测依赖", () => {
  assert.deepEqual(selectChecks(["version_alignment"]).map(c => c.name), ["openspec_cli", "version_alignment"]);
});

test("探测参数中的空格和 shell 元字符必须原样传递", async () => {
  const value = 'profile name&echo INJECTED|x%PATH%"';
  const result = await runProbe(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", value], { timeoutMs: 5000, shell: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [value]);
});

test("超时探测返回失败，不能当成正常退出", async () => {
  const result = await runProbe(process.execPath, ["-e", "setTimeout(()=>{}, 10000)"], { timeoutMs: 50 });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
});
