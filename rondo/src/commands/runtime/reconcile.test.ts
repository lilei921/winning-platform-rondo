import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRuntime } from "./reconcile.js";

const policy = JSON.stringify({
  Engineer: { primary_runtime_id: "local", fallback_runtime_id: "server" },
  "Bug Fix Agent": { primary_runtime_id: "bug-local", fallback_runtime_id: "server" },
});
const runtime = (id: string, status: string, provider = "codex") => ({ id, status, provider });
function fixture(local = "offline", server = "online", current = "local") {
  const runtimes = [runtime("local", local), runtime("server", server), runtime("bug-local", "online")];
  const agents = [
    { id: "a", name: "Engineer", runtime_id: current },
    { id: "b", name: "Bug Fix Agent", runtime_id: "bug-local" },
    { id: "v", name: "Vayne", runtime_id: "server" },
  ];
  const calls: string[][] = [];
  let writeMode = "ok";
  const client = {
    ws: () => ["--workspace-id", "workspace"],
    run(args: string[]): unknown {
      calls.push(args);
      if (args[0] === "runtime") return runtimes;
      if (args[1] === "list") return agents;
      if (args[1] === "get") return agents.find(a => a.id === args[2]);
      if (args[1] === "update") {
        const agent = agents.find(a => a.id === args[4])!;
        if (writeMode === "reject") throw new Error("forbidden");
        agent.runtime_id = args[args.indexOf("--runtime-id") + 1];
        if (writeMode === "lost") throw new Error("response lost");
        return { ...agent };
      }
      throw new Error("unexpected command");
    },
  };
  return { client, calls, runtimes, agents, mode: (mode: string) => { writeMode = mode; } };
}
const writes = (f: ReturnType<typeof fixture>) => f.calls.filter(c => c[1] === "update");

test("独立 Agent 主备切换、幂等、恢复，且不查询 Run", () => {
  const f = fixture();
  const run = () => reconcileRuntime(policy, () => f.client);
  assert.deepEqual(run(), { result: "PASS", changed: [{ agent: "Engineer", from: "local", to: "server" }], errors: [] });
  assert.equal(run().changed.length, 0);
  f.runtimes[0].status = "online";
  assert.deepEqual(run().changed, [{ agent: "Engineer", from: "server", to: "local" }]);
  assert.equal(writes(f).length, 2);
  assert.ok(f.calls.every(c => c.includes("workspace")));
  assert.ok(f.calls.every(c => c[1] !== "tasks"));
  assert.equal(f.agents[2].runtime_id, "server");
});

test("dry-run 只输出计划，不写入", () => {
  const f = fixture();
  const out = reconcileRuntime(policy, () => f.client, true);
  assert.equal(out.result, "PASS");
  assert.deepEqual(out.changed, []);
  assert.deepEqual(out.planned, [{ agent: "Engineer", from: "local", to: "server" }]);
  assert.equal(writes(f).length, 0);
});

test("双方离线、未知状态及缺失 Runtime 不改绑", () => {
  for (const [primary, fallback, expected] of [["offline", "offline", "FAIL"], ["unknown", "online", "UNKNOWN"], ["offline", "unknown", "UNKNOWN"]]) {
    const f = fixture(primary, fallback);
    const out = reconcileRuntime(policy, () => f.client);
    assert.equal(out.result, expected);
    assert.equal(writes(f).length, 0);
  }
  const f = fixture();
  f.runtimes.splice(0, 1);
  assert.equal(reconcileRuntime(policy, () => f.client).result, "UNKNOWN");
  assert.equal(writes(f).length, 0);
});

test("主备及当前 Provider 不同仍按策略改绑", () => {
  // 主备 Provider 不同：primary 离线时允许切到 claude 备机。
  const f = fixture();
  f.runtimes[1].provider = "claude";
  assert.deepEqual(reconcileRuntime(policy, () => f.client), {
    result: "PASS",
    changed: [{ agent: "Engineer", from: "local", to: "server" }],
    errors: [],
  });
  assert.equal(writes(f).length, 1);
  // 当前绑定与目标 Provider 不同：允许从 claude 改绑回 codex primary。
  const g = fixture("online", "online", "other");
  g.runtimes.push(runtime("other", "online", "claude"));
  assert.deepEqual(reconcileRuntime(policy, () => g.client).changed, [
    { agent: "Engineer", from: "other", to: "local" },
  ]);
  assert.equal(writes(g).length, 1);
});

test("缺失或非法配置不访问平台；空对象安全 no-op", () => {
  const never = () => { throw new Error("must not access platform"); };
  for (const raw of [undefined, "", "{", "null", "[]"]) {
    assert.equal(reconcileRuntime(raw, never).result, "FAIL");
  }
  assert.equal(reconcileRuntime("{}", never).result, "PASS");
});

test("单项无效、Vayne 自身策略不影响合法项", () => {
  const f = fixture();
  const raw = JSON.stringify({
    ...JSON.parse(policy),
    Vayne: { primary_runtime_id: "local", fallback_runtime_id: "server" },
    Bad: { primary_runtime_id: "local" },
  });
  const out = reconcileRuntime(raw, () => f.client);
  assert.equal(out.result, "FAIL");
  assert.equal(out.errors.length, 2);
  assert.equal(out.changed.length, 1);
  assert.equal(writes(f).length, 1);
  assert.equal(f.agents[2].runtime_id, "server");
});

test("列表查询失败不写入；重名 Agent 不猜测", () => {
  const f = fixture();
  const out = reconcileRuntime(policy, () => ({
    ws: f.client.ws,
    run: () => { throw new Error("network"); },
  }));
  assert.equal(out.result, "UNKNOWN");
  assert.equal(out.changed.length, 0);
  f.agents.push({ id: "duplicate", name: "Engineer", runtime_id: "local" });
  assert.equal(reconcileRuntime(policy, () => f.client).result, "UNKNOWN");
  assert.equal(writes(f).length, 0);
});

test("写响应丢失只回读确认；拒绝写入不重试，继续其他 Agent", () => {
  const f = fixture();
  f.mode("lost");
  assert.equal(reconcileRuntime(policy, () => f.client).changed.length, 1);
  assert.equal(writes(f).length, 1);
  assert.equal(f.calls.filter(c => c[1] === "get").length, 1);
  const g = fixture();
  g.mode("reject");
  g.runtimes[2].status = "offline";
  const out = reconcileRuntime(policy, () => g.client);
  assert.equal(out.result, "UNKNOWN");
  assert.equal(out.changed.length, 0);
  assert.equal(out.errors.length, 2);
  assert.equal(writes(g).length, 2);
});
