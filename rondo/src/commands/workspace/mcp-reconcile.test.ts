import test from "node:test";
import assert from "node:assert/strict";
import { loadMcpSpecs, reconcileMcpServers, reconcileMcpBindings, type McpDeps, type McpOverlay } from "./mcp-reconcile.js";

const template = { connection_file: "test.local.json", enabled_tools: ["search"], default_tools_approval_mode: "approve" };
const manifest = { mcp_servers: [{ name: "remote-ripgrep", template: "remote-ripgrep.json" }], agents: [
  { name: "Wayfinder", mcp_servers: ["remote-ripgrep"] },
  { name: "Analyst", mcp_servers: ["remote-ripgrep"], mcp_phase: "08-b" as const },
] };
const secret = JSON.stringify({ url: "https://example.test/mcp/private-token", headers: { Authorization: "Bearer private-secret" } });

/** 平台夹具只保留公开元数据；配置仅通过 stdin 消费。 */
function fixture(overlay: McpOverlay = {}) {
  const servers: any[] = [];
  const bindings: any[] = [];
  const calls: { args: string[]; input?: string; transient?: boolean }[] = [];
  const deps: McpDeps = {
    cli: ["multica", "--profile", "test"], workspaceId: "ws-1", dryRun: false,
    overlay, created: [], updated: [], unchanged: [], unmanaged: [],
    run(args, input, transient) {
      calls.push({ args, input, transient });
      if (args.includes("workspace")) {
        if (args.includes("list")) return structuredClone(servers);
        if (args.includes("add")) { servers.push({ id: "mcp-1", name: "remote-ripgrep" }); return servers[0]; }
        if (args.includes("update")) return servers[0];
      } else {
        if (args.includes("list")) return structuredClone(bindings);
        if (args.includes("add")) { bindings.push({ id: "mcp-1", name: "remote-ripgrep", enabled: true }); return {}; }
        if (args.includes("enable")) { bindings[0].enabled = true; return {}; }
      }
      throw new Error("unexpected call");
    },
  };
  const specs = loadMcpSpecs(manifest, overlay, () => template);
  return { deps, specs, calls, servers, bindings };
}

test("创建、持久化 ID、绑定并回读；重复执行不覆盖连接配置", () => {
  const f = fixture();
  reconcileMcpServers(f.specs, f.deps, () => secret);
  reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps);
  assert.equal(f.deps.overlay.mcp_servers?.["remote-ripgrep"].id, "mcp-1");
  assert.equal(f.bindings[0].enabled, true);
  const write = f.calls.find(c => c.input)!;
  assert.deepEqual(JSON.parse(write.input!), { ...JSON.parse(secret), enabled_tools: ["search"], default_tools_approval_mode: "approve" });
  assert.ok(write.args.includes("--server-config-stdin"));
  assert.ok(!JSON.stringify(f.deps.overlay).includes("private-"));
  f.calls.length = 0;
  reconcileMcpServers(f.specs, f.deps, () => "");
  reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps);
  assert.ok(f.calls.every(c => c.args.includes("list")));
});

test("缺凭据在任何 MCP 写入前停止；错误不包含秘密", () => {
  const f = fixture();
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => ""), /test.local.json/);
  assert.equal(f.calls.filter(c => c.input).length, 0);
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => "private-secret invalid JSON"), e => !String(e).includes("private-secret"));
});

test("dry-run 无凭据也能预演缺失配置，overlay 和平台零写入", () => {
  const f = fixture(); f.deps.dryRun = true;
  reconcileMcpServers(f.specs, f.deps, () => "");
  reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps);
  assert.deepEqual(f.deps.overlay, {});
  assert.deepEqual(f.servers, []);
  assert.ok(f.deps.created.includes("mcp/remote-ripgrep"));
  assert.ok(f.deps.created.includes("agent/Wayfinder/mcp/remote-ripgrep"));
});

test("接管唯一同名条目，启用已有禁用绑定，不覆盖配置或无关条目", () => {
  const f = fixture(); f.servers.push({ id: "mcp-1", name: "remote-ripgrep" }, { id: "other", name: "unmanaged" });
  f.bindings.push({ id: "mcp-1", name: "remote-ripgrep", enabled: false });
  reconcileMcpServers(f.specs, f.deps, () => "");
  reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps);
  assert.equal(f.bindings[0].enabled, true);
  assert.ok(f.calls.every(c => !c.input));
  assert.ok(f.deps.unmanaged.includes("mcp/unmanaged"));
});

test("拒绝重名、失效 ID 和异常 list；不把未知当成空清单", () => {
  const f = fixture({ mcp_servers: { "remote-ripgrep": { id: "wrong" } } });
  f.servers.push({ id: "mcp-1", name: "remote-ripgrep" });
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => ""), /ID/);
  delete f.deps.overlay.mcp_servers;
  f.servers.push({ id: "mcp-2", name: "remote-ripgrep" });
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => ""), /重复/);
  f.deps.run = () => ({});
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => ""), /清单/);
});

test("显式更新保留 ID；更新失败不输出平台回显的凭据", () => {
  const f = fixture(); f.servers.push({ id: "mcp-1", name: "remote-ripgrep" });
  reconcileMcpServers(f.specs, f.deps, () => secret, ["remote-ripgrep"]);
  assert.equal(f.calls.filter(c => c.args.includes("update")).length, 1);
  assert.equal(f.deps.overlay.mcp_servers?.["remote-ripgrep"].id, "mcp-1");
  f.deps.run = (_args, input) => { if (input) throw new Error(secret); return f.servers; };
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => secret, ["remote-ripgrep"]), e => /结果未知/.test(String(e)) && !String(e).includes("private-"));
});

test("08-B 绑定仅在显式选择阶段时生效；缺 Agent 报告未完成", () => {
  const f = fixture({ mcp_phase: "08-b" });
  f.servers.push({ id: "mcp-1", name: "remote-ripgrep" });
  reconcileMcpServers(f.specs, f.deps, () => "");
  assert.throws(() => reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps), /Analyst/);
});

test("模板路径、引用、阶段和凭据覆盖严格校验", () => {
  assert.throws(() => loadMcpSpecs({ ...manifest, mcp_servers: [{ name: "x", template: "../secret.json" }] }, {}, () => template));
  assert.throws(() => loadMcpSpecs(manifest, { mcp_phase: "oops" } as any, () => template));
  assert.throws(() => loadMcpSpecs({ ...manifest, agents: [{ name: "x", mcp_servers: ["missing"] }] }, {}, () => template));
  const f = fixture();
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => JSON.stringify({ url: "https://example.test", enabled_tools: ["write_file"] })));
});

test("拒绝旧环境变量引用和越界连接文件路径", () => {
  assert.throws(() => loadMcpSpecs(manifest, {}, () => ({ ...template, connection_env: "LEGACY" })));
  assert.throws(() => loadMcpSpecs(manifest, {}, () => ({ ...template, connection_file: "../private.local.json" })));
  assert.throws(() => loadMcpSpecs(manifest, { mcp_servers: { "remote-ripgrep": { connection_file: "C:/private.local.json" } } }, () => template));
});

test("文件读取异常脱敏，workspace 可引用专用连接文件", () => {
  const f = fixture({ mcp_servers: { "remote-ripgrep": { connection_file: "team-ripgrep.local.json" } } });
  assert.equal(f.specs[0].connection_file, "team-ripgrep.local.json");
  assert.throws(() => reconcileMcpServers(f.specs, f.deps, () => { throw new Error("private-secret"); }), e => /连接文件无法读取/.test(String(e)) && !String(e).includes("private-secret"));
});

test("MCP 读命令标记为可重试，写命令不标记", () => {
  const f = fixture();
  reconcileMcpServers(f.specs, f.deps, () => secret);
  reconcileMcpBindings(manifest.agents, { Wayfinder: "a-1" }, f.specs, f.deps);
  // 幂等读（清单读取、绑定读取）允许传输层重试。
  for (const call of f.calls.filter(c => c.args.includes("list"))) {
    assert.equal(call.transient, true, call.args.join(" "));
  }
  // 写操作（MCP 创建/更新、绑定 add/enable）绝不重试：可能已在服务端落地。
  for (const call of f.calls.filter(c => c.args.some(v => ["add", "update", "enable"].includes(v)))) {
    assert.notEqual(call.transient, true, call.args.join(" "));
  }
});
