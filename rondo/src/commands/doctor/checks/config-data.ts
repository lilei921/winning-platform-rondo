/**
 * doctor/checks/config-data.ts — 数据/配置层（方案 §4.4）。
 *
 * tfs_config 三来源逐级核对（配置标准：TFS_PAT/TFS_URL/TFS_COLLECTION 必须配置在用户环境变量）：
 *   ① 用户级 env（Windows 读 HKCU\Environment 注册表；Linux 读 shell profile 落盘处）——权威判据，
 *      进程 env 有 ≠ 用户 env 有（会话级 set 重启即丢、daemon 继承不到）；
 *   ② 进程 env；③ config/tfs.config.json 文件回退。
 * daemon_env 查当前进程解析链（daemon 继承启动 shell 环境，交互 shell 配了不等于 daemon 有）。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMulticaRoot } from "../../../clients/repo-root.js";
import { resolveOpenspecRootDir } from "../../../clients/runtime-paths.js";
import { DAEMON_ENV_VARS, DEFAULT_TFS_COLLECTION, PROBE_TIMEOUT_MS, TFS_COLLECTION_VAR, TFS_USER_ENV_VARS } from "../expectations.js";
import { runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

// ---------- openspec_root ----------

export async function checkOpenspecRoot(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "openspec_root";
  let monorepoRoot: string;
  try {
    ({ monorepoRoot } = resolveMulticaRoot());
  } catch {
    return { name, level: "WARN", result: "INFO", detail: "非 monorepo 上下文（cwd 上溯未命中标记目录且 MULTICA_REPO_ROOT 未设），跳过" };
  }
  let openspecRoot: string;
  try {
    openspecRoot = resolveOpenspecRootDir(monorepoRoot);
  } catch (exc) {
    return {
      name,
      level: "WARN",
      result: "WARN",
      detail: `OpenSpec 目录定位失败: ${exc instanceof Error ? exc.message : String(exc)}`,
      remediation: `确认 ${join(monorepoRoot, "openspec")} 存在且含 changes/ 子目录`,
    };
  }
  const problems: string[] = [];
  const configYaml = join(openspecRoot, "config.yaml");
  if (!existsSync(configYaml)) problems.push("openspec/config.yaml 不可读");
  const schemasDir = join(openspecRoot, "schemas");
  if (!existsSync(schemasDir)) {
    problems.push("openspec/schemas/ 目录缺失（HEY-37 次级痛点：schema 缺失会引发 agent 新一轮搜寻）");
  }
  if (problems.length > 0) {
    const available = existsSync(schemasDir) ? readdirSync(schemasDir).join(", ") : "<无>";
    return {
      name,
      level: "WARN",
      result: "WARN",
      detail: `${openspecRoot}：${problems.join("；")}；实际可用 schema: ${available}`,
      remediation: "补齐 openspec/config.yaml 与 openspec/schemas/（从根仓同步）",
    };
  }
  return { name, level: "WARN", result: "PASS", detail: openspecRoot };
}

// ---------- tfs_config ----------

type TfsSource = "user_env" | "process_env" | "config_file" | "missing";

/** 用户级环境变量探测：Windows 读 HKCU\Environment 注册表；POSIX 读 shell profile 落盘处。 */
async function userEnvHas(name: string): Promise<boolean> {
  if (process.platform === "win32") {
    const r = await runProbe("reg", ["query", "HKCU\\Environment", "/v", name], { timeoutMs: PROBE_TIMEOUT_MS });
    return r.ok && r.status === 0 && r.stdout.includes(name);
  }
  const profileCandidates = [".bashrc", ".bash_profile", ".profile"].map((f) => join(homedir(), f));
  profileCandidates.push("/etc/environment");
  const re = new RegExp(`^\\s*(?:export\\s+)?${name}=`, "m");
  return profileCandidates.some((p) => {
    try { return re.test(readFileSync(p, "utf8")); } catch { return false; }
  });
}

/** config/tfs.config.json 文件回退探测（与 tfs/config.ts 查找链对齐）。 */
function configFileHas(key: "token" | "url" | "collection"): boolean {
  const candidates: string[] = [];
  if (process.env.TFS_CLI_CONFIG) candidates.push(process.env.TFS_CLI_CONFIG);
  candidates.push(resolve(dirname(process.execPath), "..", "config", "tfs.config.json"));
  try {
    candidates.push(resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "tfs.config.json"));
  } catch { /* SEA/CJS bundle：import.meta.url 不可用 */ }
  candidates.push(resolve(process.cwd(), "config", "tfs.config.json"));
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
      if (typeof cfg[key] === "string" && cfg[key]) return true;
    } catch { /* 不存在或非法 JSON，继续 */ }
  }
  return false;
}

const TFS_FILE_KEY = { TFS_PAT: "token", TFS_URL: "url", TFS_COLLECTION: "collection" } as const;

async function tfsVarSource(name: keyof typeof TFS_FILE_KEY): Promise<TfsSource> {
  if (await userEnvHas(name)) return "user_env";
  if (process.env[name]?.trim()) return "process_env";
  if (configFileHas(TFS_FILE_KEY[name])) return "config_file";
  return "missing";
}

const SETX_HINT: Record<string, string> = {
  TFS_PAT: 'setx TFS_PAT "<pat>"',
  TFS_URL: "setx TFS_URL \"http://tfs2018-web.winning.com.cn:8080/tfs\"",
};

export async function checkTfsConfig(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "tfs_config";
  const sources = new Map<string, TfsSource>();
  for (const v of TFS_USER_ENV_VARS) sources.set(v, await tfsVarSource(v));
  sources.set(TFS_COLLECTION_VAR, await tfsVarSource(TFS_COLLECTION_VAR));

  const fmt = (v: string) => `${v}=${sources.get(v)}`;
  const evidence = [...sources.keys()].map(fmt).join("，");
  const setxSuffix = process.platform === "win32"
    ? "（用户环境变量；需重开终端/重启 daemon 生效）"
    : "（写入 ~/.bashrc 等 shell profile 持久化；需重开终端/重启 daemon 生效）";
  const cmd = (v: string) => (process.platform === "win32" ? SETX_HINT[v] : `export ${v}=...`);

  const missing = TFS_USER_ENV_VARS.filter((v) => sources.get(v) === "missing");
  if (missing.length > 0) {
    return {
      name,
      level: "FAIL",
      result: "FAIL",
      failure_kind: missing.includes("TFS_PAT") ? "missing_pat" : "missing_url",
      detail: `${evidence}——${missing.join("/")} 三个来源均未配置`,
      remediation: missing.map((v) => cmd(v)).join(" && ") + setxSuffix,
    };
  }
  const sessionOnly = TFS_USER_ENV_VARS.filter((v) => sources.get(v) === "process_env");
  if (sessionOnly.length > 0) {
    return {
      name,
      level: "FAIL",
      result: "WARN",
      failure_kind: "session_only",
      detail: `${evidence}——${sessionOnly.join("/")} 仅存在于进程 env（会话级 set 未持久化，新会话和 daemon 将丢失）`,
      remediation: sessionOnly.map((v) => cmd(v)).join(" && ") + setxSuffix,
    };
  }
  const fileOnly = TFS_USER_ENV_VARS.filter((v) => sources.get(v) === "config_file");
  if (fileOnly.length > 0) {
    return {
      name,
      level: "FAIL",
      result: "WARN",
      failure_kind: "file_fallback",
      detail: `${evidence}——${fileOnly.join("/")} 仅存在于 config/tfs.config.json 回退（不符合用户环境变量标准，daemon 环境不读该文件的风险自担）`,
      remediation: fileOnly.map((v) => cmd(v)).join(" && ") + setxSuffix,
    };
  }
  if (sources.get(TFS_COLLECTION_VAR) === "missing") {
    return { name, level: "FAIL", result: "INFO", detail: `${evidence}——TFS_COLLECTION 未配置，默认 ${DEFAULT_TFS_COLLECTION}` };
  }
  return { name, level: "FAIL", result: "PASS", detail: evidence };
}

// ---------- daemon_env ----------

export async function checkDaemonEnv(_ctx: CheckContext): Promise<CheckOutcome> {
  const name = "daemon_env";
  const missing = DAEMON_ENV_VARS.filter((v) => !process.env[v]?.trim());
  if (missing.length === 0) {
    return { name, level: "WARN", result: "PASS", detail: DAEMON_ENV_VARS.map((v) => `${v}=已配置`).join("，") };
  }
  const tfsMissing = missing.filter((v) => v !== "MULTICA_DAEMON_ID");
  if (tfsMissing.length === 0) {
    return { name, level: "WARN", result: "INFO", detail: "MULTICA_DAEMON_ID 未配置（交互 shell 属正常；daemon 主机必须配置，见 check-daemon）" };
  }
  return {
    name,
    level: "WARN",
    result: "WARN",
    detail: `当前进程环境缺少: ${missing.join(", ")}（daemon 继承启动 shell 环境，交互 shell 配了不等于 daemon 有——参照 test220 事故史）`,
    remediation: "为 daemon 的 OS/服务环境配置缺失变量并重启 daemon（部署手册 runbook）",
  };
}
