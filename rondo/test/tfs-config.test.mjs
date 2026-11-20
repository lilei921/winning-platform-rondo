import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DEFAULT_TFS_COLLECTION } from "../dist/commands/doctor/expectations.js";
import { TFS_API_USAGE } from "../dist/tfs/usage.js";

const CONFIG_URL = new URL("../dist/tfs/config.js", import.meta.url).href;

/** 使用独立进程和显式临时配置，隔离宿主环境及真实凭据；仅解析配置，不访问 TFS。 */
function readConfig(t, file = { token: "fixture-only" }, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-tfs-config-"));
  t.after(() => {
    // 删除前核实临时目录归属，避免递归清理越界。
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  const configPath = join(dir, "tfs.config.json");
  writeFileSync(configPath, JSON.stringify(file));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("TFS_")));
  const script = `
    const { loadConfig, ConfigError } = await import(${JSON.stringify(CONFIG_URL)});
    try {
      const { serverUrl, collection } = loadConfig();
      process.stdout.write(JSON.stringify({ serverUrl, collection }));
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      process.stdout.write(JSON.stringify({ configError: error.message }));
      process.exitCode = 3;
    }
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: dir, encoding: "utf8", timeout: 10000,
    env: { ...env, ...overrides, TFS_CLI_CONFIG: configPath },
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.stderr, "");
  return { code: result.status, body: JSON.parse(result.stdout) };
}

test("未配置集合时默认访问 WN_Data_Platform，PAT 可从文件读取", t => {
  const result = readConfig(t);
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, {
    collection: "WN_Data_Platform",
    serverUrl: "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform",
  });
});

test("配置文件 collection 覆盖默认值，仍可显式选择旧集合", t => {
  const result = readConfig(t, { token: "fixture-only", url: "http://file.invalid/tfs/", collection: "WINNING-6.0" });
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, { collection: "WINNING-6.0", serverUrl: "http://file.invalid/tfs/WINNING-6.0" });
});

test("环境变量 collection 和 base URL 优先于文件配置", t => {
  const result = readConfig(t, { token: "fixture-only", url: "http://file.invalid/tfs", collection: "FileCollection" }, {
    TFS_COLLECTION: "EnvCollection", TFS_URL: "http://env.invalid/tfs/",
  });
  assert.equal(result.code, 0);
  assert.deepEqual(result.body, { collection: "EnvCollection", serverUrl: "http://env.invalid/tfs/EnvCollection" });
});

test("仅配置完整 TFS_SERVER_URL 时无需集合变量，完整地址优先于 base URL", t => {
  const result = readConfig(t, { token: "fixture-only" }, {
    TFS_SERVER_URL: "http://full.invalid/tfs/ExplicitCollection/", TFS_URL: "http://base.invalid/tfs",
  });
  assert.equal(result.code, 0);
  assert.equal(result.body.serverUrl, "http://full.invalid/tfs/ExplicitCollection");
});

test("仅有环境变量 PAT 时仍使用新默认集合", t => {
  const result = readConfig(t, {}, { TFS_PAT: "fixture-only" });
  assert.equal(result.code, 0);
  assert.equal(result.body.collection, "WN_Data_Platform");
});

test("PAT 缺失仍报告配置错误", t => {
  const result = readConfig(t, {});
  assert.equal(result.code, 3);
  assert.match(result.body.configError, /TFS PAT 未配置/);
});

test("doctor 和 CLI 帮助均展示新的默认集合", () => {
  assert.equal(DEFAULT_TFS_COLLECTION, "WN_Data_Platform");
  assert.match(TFS_API_USAGE, /TFS_COLLECTION\s+集合名\(默认 WN_Data_Platform\)/);
  assert.ok(!TFS_API_USAGE.includes("WINNING-6.0"));
});
