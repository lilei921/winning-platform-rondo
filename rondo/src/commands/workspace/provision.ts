/**
 * workspace provision — 平台对象供给自动化（archive/docs-2026-10-26/workspace-provisioning-plan.md §2（历史溯源））。
 *
 * （rondo 收编：实现位置为 @winning/skill-flow 包内 commands/workspace/provision.ts，
 * 原 projects/multica/scripts/provision-workspace.ts 在迁移窗口期保持有效。）
 *
 * 职责：按 workspace-config/provisioning.json manifest + 仓内资产（agents/、squads/、skills/）
 *   在目标工作区 reconcile manifest 显式受管的平台对象（MCP/Skill/Agent/Squad/Project/Autopilot），
 *   并把解析到的对象 ID 原子写入 workspaces/<name>.json overlay（脚本是 overlay 唯一写入者）。
 *   manifest.workflow.statuses 存在时另做 Workflow 自定义状态 reconcile（只增不删不改序，
 *   需 multica ≥0.8.0；本段失败不阻断前段成果落盘，归并 exit 3，见 workflow-reconcile.ts）。
 *   内容同步（Skill 文件 upsert/reconcile）归 sync-workspace，本命令不管。
 *
 * 同步模型（§1）：语义层收敛（仓内=权威、单向覆盖、幂等可重入）+ 执行层回读式 diff
 *   （list/get 回读平台实际状态参与比对；created/updated/unchanged/unmanaged_remote 四分类；
 *   对象级多出不删只列明）。MCP 完整配置只写，仅显式更新，不用本地 Hash 伪装平台回读。
 *
 * 用法：
 *   rondo workspace provision --workspace <name> [--slug <slug>]
 *                                  [--create-workspace [--display-name <n>]]
 *                                  [--runtime-id <uuid>] [--profile <name>] [--dry-run] [--skip-workflow]
 *   --workspace        overlay 名（workspace-config/workspaces/<name>.json）
 *   --slug             工作区 slug，经 workspace list 解析 workspace_id；缺省用 overlay 已有的 workspace_id
 *   --create-workspace 工作区不存在时先创建（需要 --slug）
 *   --runtime-id       agent create 用 runtime；缺省时 runtime list 唯一则自动取，多个/零个 → exit 3
 *   --profile          multica 配置 profile（云端/97 等多环境；追加到全部 multica 调用，缺省走 CLI 默认 profile）
 *   --dry-run          只回读比对出预演清单，零创建零更新零写盘
 *   --skip-workflow    显式跳过 workflow 能力检查与状态供给，兼容不支持 workflow 的服务端
 *   --mcp-only         仅维护已有 workspace 的 MCP 和 Agent 绑定，不触碰其他资产
 *   --check            只读检查，缺失/漂移 exit 2；MCP 完整配置不可回读，运行验证单列 NOT_RUN
 *   --update-mcp       逗号分隔名称，使用当前模板与预备连接文件显式替换完整连接配置
 *
 * 退出码：0 PASS / 2 DRIFT（--check）/ 3 UNKNOWN（已获得的 ID 仍落盘，重跑断点续建）/ 64 用法错误。
 * stdout 只出 JSON；日志走 stderr。
 *
 * 运行环境：Node ≥ 23.6 直跑（22.6+ 需 --experimental-strip-types）；只用可擦除类型注解；零 npm 依赖。
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand, runJson, runJsonStdin } from "../../clients/spawn.js";
import { readSkillContent } from "./skill-content.js";
import { resolveMulticaRoot } from "../../clients/repo-root.js";
import { bindEnvironment, multicaPrefix, type MulticaEnvironment } from "../../clients/multica-environment.js";
import { BUILTIN_STATUS_KEYS } from "../../clients/required-statuses.js";
import { reconcileWorkflowStatuses, readWorkflowSteps, workflowCliSupported, type ManifestWorkflow } from "./workflow-reconcile.js";
import { planSquadMemberChanges, validateSquadMembers, type SquadMemberCurrent, type SquadMemberSpec } from "./squad-members.js";
import { loadMcpSpecs, mcpPayload, reconcileMcpServers, reconcileMcpBindings, type McpAgent, type McpManifest, type McpOverlay, type McpDeps } from "./mcp-reconcile.js";

// 根定位见 clients/repo-root.ts（npm pack 全局安装后不能按包内位置回推）。
// 模块级可变绑定由 main() 开头的 initRoots() 填充，helper 函数引用。
let REPO_ROOT = "";
let CONFIG_ROOT = "";
let SKILLS_ROOT = "";
let AGENTS_ROOT = "";
let SQUAD_INSTRUCTIONS = "";
function initRoots(): void {
  const r = resolveMulticaRoot();
  REPO_ROOT = r.multicaRoot;
  CONFIG_ROOT = join(REPO_ROOT, "workspace-config");
  SKILLS_ROOT = join(REPO_ROOT, "skills");
  AGENTS_ROOT = join(REPO_ROOT, "agents");
  SQUAD_INSTRUCTIONS = join(REPO_ROOT, "squads", "squad-instructions.md");
}

interface ManifestAgent extends McpAgent { dir: string; name: string; visibility?: string; skills?: string[]; }
interface ManifestAutopilot { title: string; agent: string; mode: string; prompt_file: string; }
interface Manifest extends McpManifest {
  managed_skills: string[];
  agents: ManifestAgent[];
  squad: { name: string; leader: string; members: SquadMemberSpec[] };
  project: { title: string; workspace_branch?: string; description?: string };
  workspace_groups?: Record<string, {
    workspaces?: string[];
    project?: Partial<Manifest["project"]>;
    mcp_servers?: McpManifest["mcp_servers"];
  }>;
  autopilots: ManifestAutopilot[];
  /** 自定义 workflow 状态供给（workspace-workflow-status-provisioning-plan M1）；缺段则整段跳过，向后兼容。 */
  workflow?: ManifestWorkflow;
}

interface Overlay extends MulticaEnvironment, McpOverlay {
  workspace_id?: string;
  delivery_squad_id?: string;
  project?: string;
  skills?: Record<string, string>;
  [k: string]: unknown;
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

function readJson(path: string, what: string): any {
  if (!existsSync(path)) throw new UnknownError(`${what} 不存在: ${path}`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (exc) { throw new UnknownError(`${what} 不是合法 JSON (${path}): ${exc}`); }
}

/** 读文本资产：去 BOM、CRLF→LF（平台存储与比对统一为 LF） */
function readText(path: string, what: string): string {
  if (!existsSync(path)) throw new UnknownError(`${what} 不存在: ${path}`);
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");}

/** 文本一致性比对：忽略行尾空白差异（平台回读可能无尾换行） */
function sameText(a: string, b: string): boolean {
  return a.replace(/\s+$/g, "") === b.replace(/\s+$/g, "");
}

// --- 仓内事实源 ---

/** 受管 Skill 清单：只供给 manifest 显式登记的 Skill，保留仓内其他独立资产。 */
function listManagedSkills(managedSkills: string[]): string[] {
  const seen = new Set<string>();
  for (const skill of managedSkills) {
    if (typeof skill !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(skill)) {
      throw new UnknownError(`managed_skills 含非法 Skill 名: ${skill}`);
    }
    if (seen.has(skill)) throw new UnknownError(`managed_skills 重复登记 Skill: ${skill}`);
    if (!existsSync(join(SKILLS_ROOT, skill, "SKILL.md"))) {
      throw new UnknownError(`受管 Skill ${skill} 缺 SKILL.md`);
    }
    seen.add(skill);
  }
  return [...seen].sort();
}

/** 从 SKILL.md frontmatter 解析 description（YAML 子集：单行值） */
function skillDescription(skill: string, md: string): string {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new UnknownError(`Skill ${skill} 的 SKILL.md 缺 frontmatter`);
  const d = m[1].match(/^description:\s*(.+)$/m);
  if (!d) throw new UnknownError(`Skill ${skill} 的 SKILL.md frontmatter 缺 description`);
  return d[1].trim();
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) { out[key] = next; i++; }
      else out[key] = true;
    }
  }
  return out;
}

// --- reconcile 累积器 ---
const created: string[] = [];
const updated: string[] = [];
const unchanged: string[] = [];
const unmanaged: string[] = [];

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  if (typeof args.workspace !== "string" || !args.workspace) {
    process.stderr.write(
      "用法: rondo workspace provision --workspace <name> [--slug <slug>] [--create-workspace [--display-name <n>]] [--runtime-id <uuid>] [--profile <name>] [--dry-run | --check] [--skip-workflow] [--mcp-only] [--update-mcp <name,...>]\n",
    );
    return 64;
  }
  const check = args.check === true;
  const dryRun = args["dry-run"] === true || check;
  const mcpOnly = args["mcp-only"] === true;
  const skipWorkflow = args["skip-workflow"] === true || mcpOnly;
  const updates = typeof args["update-mcp"] === "string" ? args["update-mcp"].split(",") : [];
  const invalidReadOnlyFlag = ["dry-run", "check", "mcp-only"].some(key => args[key] !== undefined && args[key] !== true);
  if (invalidReadOnlyFlag || (args["update-mcp"] !== undefined && !updates.length) || (check && (updates.length || args["create-workspace"]))
      || (mcpOnly && args["create-workspace"]) || !/^[\w.-]+$/.test(args.workspace) || [".", ".."].includes(args.workspace)) {
    process.stderr.write("workspace 必须为单个名称；--check / --dry-run / --mcp-only 不接受值；--update-mcp 需要逗号分隔名称；--check 不接受更新或创建；--mcp-only 仅用于已有工作区\n");
    return 64;
  }
  // 同一进程重复调用时也不继承上次供给报告。
  created.length = updated.length = unchanged.length = unmanaged.length = 0;
  // --profile：multica 配置 profile（云端/97 等多环境，自带 server_url+token）；缺省走 CLI 默认 profile
  let SRV: string[] = [];
  let MC: string[] = [];
  // 根目录解析与 overlay 读取放进 try：UnknownError 统一走契约输出（exit 3 + stdout JSON）
  let overlayPath = "";
  let overlay: Overlay = {};
  let allowOverlayWrite = false;

  // 失败时也要把已获得的 ID 落盘（断点续建），所以 overlay 写入封装成函数，catch 里复用
  const writeOverlay = (): boolean => {
    if (dryRun || !allowOverlayWrite || !overlay.workspace_id) return false;
    const out: Overlay = { ...overlay };
    const tmp = `${overlayPath}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n");
    renameSync(tmp, overlayPath);
    log(`overlay 已写入: ${overlayPath}`);
    return true;
  };

  try {
    initRoots();
    overlayPath = join(CONFIG_ROOT, "workspaces", `${args.workspace}.json`);
    overlay = existsSync(overlayPath) ? readJson(overlayPath, `工作区 overlay ${args.workspace}`) : {};
    const manifest = readJson(join(CONFIG_ROOT, "provisioning.json"), "provisioning manifest") as Manifest;
    // 分组仅合并到本次调用的内存配置，避免同步时改写共享 manifest。
    const slug = typeof args.slug === "string" ? args.slug : args.workspace;
    const group = Object.values(manifest.workspace_groups ?? {}).find(g => g.workspaces?.includes(slug));
    if (group) {
      manifest.project = { ...manifest.project, ...group.project };
      if (group.mcp_servers !== undefined) manifest.mcp_servers = group.mcp_servers;
    }
    const mcpSpecs = loadMcpSpecs(manifest, overlay, file => readJson(join(REPO_ROOT, "mcps", file), "MCP 模板"));
    if (mcpOnly && !mcpSpecs.length) throw new UnknownError("manifest 尚未登记受管 MCP");
    if (updates.some(name => !mcpSpecs.some(s => s.name === name))) throw new UnknownError("--update-mcp 包含未登记 MCP");
    // 正式维护前先备齐所有连接文件；缓存本次内容，确保预检与实际写入使用同一份配置。
    const connectionFiles = new Map<string, string>();
    const readConnection = (file: string): string => {
      if (!connectionFiles.has(file)) connectionFiles.set(file, readFileSync(join(REPO_ROOT, "mcps", "connections", file), "utf8"));
      return connectionFiles.get(file)!;
    };
    if (!dryRun) for (const spec of mcpSpecs) mcpPayload(spec, readConnection);
    // 仅对本次调用关闭 workflow，不改共享 manifest，也不把接口错误自动判作旧版本。
    const workflow = skipWorkflow ? undefined : manifest.workflow;
    if (skipWorkflow) log("已显式跳过 workflow 检查与状态供给；依赖自定义状态的流程仍需服务端支持。");

    // --- manifest 静态校验（防呆：显式受管 Skill 与引用资产必须存在） ---
    if (!Array.isArray(manifest.managed_skills) || manifest.managed_skills.length === 0) {
      throw new UnknownError("manifest 缺少非空 managed_skills 清单");
    }
    const repoSkills = listManagedSkills(manifest.managed_skills);
    const problems: string[] = [];
    for (const a of manifest.agents) {
      const dir = join(AGENTS_ROOT, a.dir);
      if (!existsSync(join(dir, "instructions.md"))) problems.push(`agent ${a.dir} 缺 instructions.md`);
      if (!existsSync(join(dir, "description.md"))) problems.push(`agent ${a.dir} 缺 description.md`);
      for (const s of a.skills ?? []) if (!repoSkills.includes(s)) problems.push(`agent ${a.dir} 绑定的 Skill ${s} 不在 managed_skills 受管清单`);
    }
    for (const ap of manifest.autopilots) {
      if (!existsSync(join(REPO_ROOT, ap.prompt_file))) problems.push(`autopilot ${ap.title} 的 prompt_file 不存在: ${ap.prompt_file}`);
      if (!manifest.agents.some((a) => a.name === ap.agent)) problems.push(`autopilot ${ap.title} 引用的 agent ${ap.agent} 不在 manifest`);
    }
    if (!manifest.agents.some((a) => a.name === manifest.squad.leader)) problems.push(`squad leader ${manifest.squad.leader} 不在 manifest.agents`);
    problems.push(...validateSquadMembers(manifest.squad.members, new Set(manifest.agents.map(a => a.name))));
    if (!existsSync(SQUAD_INSTRUCTIONS)) problems.push(`squad instructions 不存在: ${SQUAD_INSTRUCTIONS}`);
    // workflow.statuses 静态校验（自定义状态供给；name+category 成对出现才具备新建参数）
    if (workflow !== undefined) {
      const wfs = workflow?.statuses;
      if (!Array.isArray(wfs) || wfs.length === 0) {
        problems.push("workflow.statuses 必须是非空数组（无供给需求时整段省略 workflow）");
      } else {
        const builtins = new Set<string>(BUILTIN_STATUS_KEYS);
        const seenKeys = new Set<string>();
        for (const s of wfs) {
          if (!s || typeof s.key !== "string" || !/^[a-z0-9][a-z0-9_]*$/.test(s.key)) {
            problems.push(`workflow.statuses 含非法 key: ${JSON.stringify(s)}`);
            continue;
          }
          if (seenKeys.has(s.key)) problems.push(`workflow.statuses 重复登记: ${s.key}`);
          seenKeys.add(s.key);
          if (builtins.has(s.key)) problems.push(`workflow.statuses ${s.key} 是 multica 内建状态键，无需声明`);
          if ((s.name ? 1 : 0) !== (s.category ? 1 : 0)) {
            problems.push(`workflow.statuses ${s.key}: name 与 category 必须成对出现（新建状态的创建参数）`);
          }
        }
      }
    }
    if (problems.length > 0) throw new UnknownError(`manifest 校验失败:\n  - ${problems.join("\n  - ")}`);

    // 在任何平台写入前绑定环境并检查 workflow CLI 能力。
    const env = bindEnvironment(overlay, args.profile, prefix => {
      const cp = runCommand([...prefix, "config", "show"]);
      if (cp.status !== 0) throw new UnknownError("multica config show 失败");
      return process.env.MULTICA_SERVER_URL || /^server_url:\s*(\S+)$/m.exec(cp.stdout)?.[1] || "";
    });
    Object.assign(overlay, env);
    MC = multicaPrefix({ multica_cli: "multica", ...env });
    SRV = MC.slice(1);
    if (workflow?.statuses?.length && !workflowCliSupported(runCommand([...MC, "--version"]).stdout).supported) {
      throw new UnknownError("workflow 供给需要 multica CLI ≥0.8.0；尚未修改平台对象");
    }

    // --- 0. workspace 解析 ---
    let wsId: string | undefined;
    if (typeof args.slug === "string" && args.slug) {
      const wsList = runJson([...MC, "workspace", "list", "--output", "json"], "workspace list", undefined, { transient: true }) as Array<Record<string, any>>;
      let ws = wsList.find((w) => w.slug === args.slug);
      if (!ws && args["create-workspace"] === true) {
        if (overlay.workspace_id) {
          throw new UnknownError("overlay 已绑定工作区，不能用不存在的 slug 创建另一工作区；请核对 slug 或使用独立 overlay");
        }
        const displayName = typeof args["display-name"] === "string" ? args["display-name"] : args.slug;
        if (dryRun) {
          // 工作区尚不存在，后续回读没有有效 ID；只输出计划，明确待创建后检查的项目。
          process.stdout.write(JSON.stringify({
            result: "PASS", workspace: args.workspace, mode: "dry-run",
            created: [`workspace/${args.slug}`, ...mcpSpecs.map(s => `mcp/${s.name}`), ...repoSkills.map(s => `skill/${s}`),
              ...manifest.agents.map(a => `agent/${a.name}`), `squad/${manifest.squad.name}`,
              ...manifest.agents
                .flatMap(a => (a.mcp_servers ?? []).map(name => `agent/${a.name}/mcp/${name}`)),
              `project/${manifest.project.title}`, ...manifest.autopilots.map(a => `autopilot/${a.title}`)],
            updated: [], unchanged: [], unmanaged_remote: [], overlay_written: false, next: null,
            workflow_skipped: skipWorkflow,
            deferred_checks: ["runtime", ...(workflow?.statuses?.length ? ["workflow"] : [])],
            ...(mcpSpecs.length ? { mcp_configuration: "WRITE_ONLY_NOT_VERIFIED", mcp_runtime: "NOT_RUN" } : {}),
          }, null, 2) + "\n");
          return 0;
        } else {
          const cp = runJson([...MC, "workspace", "create", "--name", displayName, "--slug", args.slug, "--output", "json"], "workspace create") as any;
          created.push(`workspace/${args.slug}`);
          ws = { id: cp.id ?? cp.workspace?.id };
          if (!ws.id || typeof ws.id !== "string") throw new UnknownError("workspace create 输出缺 id");
          // 新建已发生平台写入，先保存恢复身份；后续 runtime/API 检查失败仍可原地重跑。
          overlay.workspace_id = ws.id;
          overlay.provisioning_required = repoSkills;
          allowOverlayWrite = true;
          writeOverlay();
        }
      }
      if (!ws) throw new UnknownError(`工作区 slug=${args.slug} 不存在（--create-workspace 可自动创建）`);
      wsId = ws?.id;
      if (wsId && overlay.workspace_id && overlay.workspace_id !== wsId) {
        throw new UnknownError(`overlay 的 workspace_id (${overlay.workspace_id}) 与 slug 解析结果 (${wsId}) 不一致——防呆中止，请人工核对`);
      }
    } else if (overlay.workspace_id) {
      wsId = overlay.workspace_id;
    } else {
      throw new UnknownError("缺少 --slug（且 overlay 无 workspace_id）——无法定位目标工作区");
    }
    if (wsId) overlay.workspace_id = wsId;
    if (!wsId || typeof wsId !== "string") throw new UnknownError("无法解析有效的 workspace_id");
    const WS = ["--workspace-id", wsId];
    const mcpDeps: McpDeps = {
      cli: MC, workspaceId: wsId, dryRun, overlay, created, updated, unchanged, unmanaged,
      allowMissingAgents: !mcpOnly,
      // transient=true 只出现在幂等读上：传输层故障重试；带 input 的配置写入与
      // agent mcp add/enable 都是写操作，一律不重试。
      run: (cmd, input, transient) => {
        if (input !== undefined) return runJsonStdin(cmd, "MCP 配置写入", input);
        return runJson(cmd, "MCP 元数据读取", undefined, transient ? { transient: true } : undefined);
      },
    };
    if (mcpOnly) {
      // 专项维护不触碰 Agent 正文、Skill、Squad、Project 或 Autopilot。
      const agents = runJson([...MC, "agent", "list", ...WS, "--output", "json"], "agent list") as Array<Record<string, any>>;
      if (!Array.isArray(agents) || agents.some(a => !a?.id || !a?.name)
          || new Set(agents.map(a => a.name)).size !== agents.length) throw new UnknownError("Agent 清单非法或重名，禁止 MCP 绑定");
      const ids = Object.fromEntries(agents.map(a => [a.name, a.id]));
      for (const a of manifest.agents) {
        if (a.mcp_servers?.length && !ids[a.name]) {
          throw new UnknownError(`MCP 绑定缺少 Agent ${a.name}，请先完整 provision`);
        }
      }
      allowOverlayWrite = true;
      reconcileMcpServers(mcpSpecs, mcpDeps, readConnection, updates);
      reconcileMcpBindings(manifest.agents, ids, mcpSpecs, mcpDeps);
      const drift = check && (created.length > 0 || updated.length > 0);
      process.stdout.write(JSON.stringify({
        result: drift ? "DRIFT" : "PASS", workspace: args.workspace, workspace_id: wsId,
        mode: check ? "check" : dryRun ? "dry-run" : "provision", scope: "mcp",
        created, updated, unchanged, unmanaged_remote: unmanaged, overlay_written: writeOverlay(),
        mcp_configuration: "WRITE_ONLY_NOT_VERIFIED", mcp_runtime: "NOT_RUN",
      }, null, 2) + "\n");
      return drift ? 2 : 0;
    }

    // 已有工作区在供给对象前校验服务端 API，避免旧服务端导致部分供给。
    if (workflow?.statuses?.length && wsId) {
      try {
        readWorkflowSteps(runJson([...MC, "workflow", "get", workflow.ref ?? "default", ...WS, "--output", "json"], "workflow 前置检查"));
      } catch (error) {
        throw new UnknownError(`workflow 服务端前置检查失败，未开始对象供给: ${String(error)}`);
      }
    }

    // --- 1. runtime 校验 ---
    const runtimes = runJson([...MC, "runtime", "list", ...WS, "--output", "json"], "runtime list", undefined, { transient: true }) as Array<Record<string, any>>;
    let runtimeId: string;
    if (typeof args["runtime-id"] === "string" && args["runtime-id"]) {
      if (!runtimes.some((r) => r.id === args["runtime-id"])) throw new UnknownError(`--runtime-id ${args["runtime-id"]} 不在目标工作区 runtime 清单`);
      runtimeId = args["runtime-id"];
    } else if (runtimes.length === 1) {
      runtimeId = runtimes[0].id;
    } else if (runtimes.length === 0) {
      throw new UnknownError("目标工作区无可用 runtime（runtime 是 workspace 级对象；先在目标工作区启动 daemon 注册 runtime）");
    } else {
      throw new UnknownError(`目标工作区有 ${runtimes.length} 个 runtime，需 --runtime-id 显式指定: ${runtimes.map((r) => `${r.id}(${r.device_info ?? "?"})`).join(", ")}`);
    }
    log(`runtime: ${runtimeId}`);
    allowOverlayWrite = true;
    // 只有整轮对象、绑定与工作流均成功后才解除同步门禁；失败时保留恢复标志。
    overlay.provisioning_required = repoSkills;
    reconcileMcpServers(mcpSpecs, mcpDeps, readConnection, updates);

    // --- 2. Skill reconcile ---
    const remoteSkills = runJson([...MC, "skill", "list", ...WS, "--output", "json"], "skill list", undefined, { transient: true }) as Array<Record<string, any>>;
    const skillByName = new Map(remoteSkills.map((s) => [s.name, s]));
    const skillIds: Record<string, string> = {};
    for (const skill of repoSkills) {
      const hit = skillByName.get(skill);
      if (hit) {
        skillIds[skill] = hit.id;
        unchanged.push(`skill/${skill}`);
      } else if (dryRun) {
        created.push(`skill/${skill}`);
      } else {
        const skillMd = join(SKILLS_ROOT, skill, "SKILL.md");
        if (!existsSync(skillMd)) throw new UnknownError(`Skill ${skill} 缺 SKILL.md: ${skillMd}`);
        const content = readSkillContent(skillMd);
        const cp = runJsonStdin(
          [...MC, "skill", "create", ...WS, "--name", skill, "--description", skillDescription(skill, content),
            "--content-stdin", "--output", "json"],
          `skill create ${skill}`, content,
        ) as any;
        const id = cp.id ?? cp.skill?.id;
        if (!id) throw new UnknownError(`skill create ${skill} 输出缺 id`);
        skillIds[skill] = id;
        created.push(`skill/${skill}`);
      }
    }
    for (const rs of remoteSkills) if (!repoSkills.includes(rs.name)) unmanaged.push(`skill/${rs.name}`);
    overlay.skills = skillIds;

    // --- 3. Agent reconcile（含 skills 绑定收敛） ---
    const remoteAgents = runJson([...MC, "agent", "list", ...WS, "--output", "json"], "agent list", undefined, { transient: true }) as Array<Record<string, any>>;
    if (!Array.isArray(remoteAgents) || remoteAgents.some(a => !a?.id || !a?.name)
        || new Set(remoteAgents.map(a => a.name)).size !== remoteAgents.length) throw new UnknownError("Agent 清单非法或重名，禁止供给绑定");
    const agentByName = new Map(remoteAgents.map((a) => [a.name, a]));
    const agentIds: Record<string, string> = {};
    for (const a of manifest.agents) {
      const instr = readText(join(AGENTS_ROOT, a.dir, "instructions.md"), `agent ${a.dir} instructions`);
      const desc = readText(join(AGENTS_ROOT, a.dir, "description.md"), `agent ${a.dir} description`).trim();
      const wantVisibility = a.visibility ?? "workspace";
      const wantSkills = [...(a.skills ?? [])].sort();
      const hit = agentByName.get(a.name);
      if (!hit) {
        if (dryRun) {
          created.push(`agent/${a.name}`);
        } else {
          const cp = runJson(
            [...MC, "agent", "create", ...WS, "--name", a.name, "--runtime-id", runtimeId,
              "--description", desc, "--instructions", instr, "--visibility", wantVisibility, "--output", "json"],
            `agent create ${a.name}`,
          ) as any;
          const id = cp.id ?? cp.agent?.id;
          if (!id) throw new UnknownError(`agent create ${a.name} 输出缺 id`);
          agentIds[a.name] = id;
          created.push(`agent/${a.name}`);
          if (wantSkills.length > 0) {
            runJson([...MC, "agent", "skills", "set", ...WS, id, "--skill-ids", wantSkills.map((s) => skillIds[s]).join(","), "--output", "json"], `agent skills set ${a.name}`);
          }
        }
        continue;
      }
      agentIds[a.name] = hit.id;
      const drift: string[] = [];
      if (!sameText(hit.instructions ?? "", instr)) drift.push("instructions");
      if ((hit.description ?? "") !== desc) drift.push("description");
      if (hit.visibility !== wantVisibility) drift.push("visibility");
      if (drift.length > 0) {
        if (dryRun) {
          updated.push(`agent/${a.name} (${drift.join(",")})`);
        } else {
          const cmd = [...MC, "agent", "update", ...WS, hit.id, "--output", "json"];
          if (drift.includes("instructions")) cmd.push("--instructions", instr);
          if (drift.includes("description")) cmd.push("--description", desc);
          if (drift.includes("visibility")) cmd.push("--visibility", wantVisibility);
          runJson(cmd, `agent update ${a.name}`);
          updated.push(`agent/${a.name} (${drift.join(",")})`);
        }
      }
      const hasSkills = ((hit.skills ?? []) as Array<Record<string, any>>).map((s) => s.name).sort();
      if (JSON.stringify(hasSkills) !== JSON.stringify(wantSkills)) {
        if (dryRun) {
          updated.push(`agent/${a.name} (skills: [${hasSkills}] → [${wantSkills}])`);
        } else {
          runJson([...MC, "agent", "skills", "set", ...WS, hit.id, "--skill-ids", wantSkills.map((s) => skillIds[s]).join(","), "--output", "json"], `agent skills set ${a.name}`);
          updated.push(`agent/${a.name} (skills)`);
        }
      }
      if (drift.length === 0 && JSON.stringify(hasSkills) === JSON.stringify(wantSkills)) unchanged.push(`agent/${a.name}`);
    }
    const manifestAgentNames = new Set(manifest.agents.map((a) => a.name));
    for (const ra of remoteAgents) if (!manifestAgentNames.has(ra.name)) unmanaged.push(`agent/${ra.name}`);
    reconcileMcpBindings(manifest.agents, agentIds, mcpSpecs, mcpDeps);

    // --- 4. Squad reconcile ---
    const squadInstr = readText(SQUAD_INSTRUCTIONS, "squad instructions");
    const remoteSquads = runJson([...MC, "squad", "list", ...WS, "--output", "json"], "squad list", undefined, { transient: true }) as Array<Record<string, any>>;
    let squad = remoteSquads.find((s) => s.name === manifest.squad.name);
    if (!squad) {
      if (dryRun) {
        created.push(`squad/${manifest.squad.name}`);
      } else {
        const cp = runJson(
          [...MC, "squad", "create", ...WS, "--name", manifest.squad.name, "--leader", manifest.squad.leader, "--output", "json"],
          "squad create",
        ) as any;
        const id = cp.id ?? cp.squad?.id;
        if (!id) throw new UnknownError("squad create 输出缺 id");
        squad = { id };
        created.push(`squad/${manifest.squad.name}`);
      }
    }
    if (squad) {
      overlay.delivery_squad_id = squad.id;
      const leaderId = agentIds[manifest.squad.leader];
      const sDrift: string[] = [];
      if (squad.instructions !== undefined && !sameText(squad.instructions, squadInstr)) sDrift.push("instructions");
      if (squad.leader_id !== undefined && leaderId && squad.leader_id !== leaderId) sDrift.push("leader");
      if (sDrift.length > 0) {
        if (dryRun) {
          updated.push(`squad/${manifest.squad.name} (${sDrift.join(",")})`);
        } else {
          const cmd = [...MC, "squad", "update", ...WS, squad.id, "--output", "json"];
          if (sDrift.includes("instructions")) cmd.push("--instructions", squadInstr);
          if (sDrift.includes("leader")) cmd.push("--leader", manifest.squad.leader);
          runJson(cmd, "squad update");
          updated.push(`squad/${manifest.squad.name} (${sDrift.join(",")})`);
        }
      }
      // 新建的 squad 还没有 instructions（create 无此 flag）——update 注入
      if (squad.instructions === undefined && !dryRun) {
        runJson([...MC, "squad", "update", ...WS, squad.id, "--instructions", squadInstr, "--output", "json"], "squad update instructions");
      }
      // members + role 收敛（只增/改 Role，不删除；Role 来自 manifest）
      const members = runJson([...MC, "squad", "member", "list", ...WS, squad.id, "--output", "json"], "squad member list", undefined, { transient: true }) as SquadMemberCurrent[];
      const memberChanges = planSquadMemberChanges(manifest.squad.members, agentIds, members);
      const memberAction = memberChanges.length > 0;
      for (const change of memberChanges) {
        if (change.kind === "add") {
          if (dryRun) {
            updated.push(`squad/${manifest.squad.name} (+member ${change.name}, role)`);
          } else {
            runJson([...MC, "squad", "member", "add", ...WS, squad.id,
              "--member-id", change.memberId, "--type", "agent", "--role", change.role, "--output", "json"],
            `squad member add ${change.name}`);
            updated.push(`squad/${manifest.squad.name} (+member ${change.name}, role)`);
          }
        } else {
          if (dryRun) {
            updated.push(`squad/${manifest.squad.name} (role ${change.name})`);
          } else {
            runJson([...MC, "squad", "member", "set-role", ...WS, squad.id,
              "--member-id", change.memberId, "--member-type", "agent", "--role", change.role, "--output", "json"],
            `squad member set-role ${change.name}`);
            updated.push(`squad/${manifest.squad.name} (role ${change.name})`);
          }
        }
      }
      if (memberAction && !dryRun) {
        const afterMembers = runJson([...MC, "squad", "member", "list", ...WS, squad.id, "--output", "json"], "squad member readback", undefined, { transient: true }) as SquadMemberCurrent[];
        const remaining = planSquadMemberChanges(manifest.squad.members, agentIds, afterMembers);
        if (remaining.length > 0) {
          throw new UnknownError(`squad member role 回读未收敛: ${remaining.map(c => c.name).join(", ")}`);
        }
      }
      const wantMemberIds = new Set([leaderId, ...manifest.squad.members.map(m => agentIds[m.name])].filter(Boolean));
      for (const m of members) if (m.member_type === "agent" && wantMemberIds.size > 0 && !wantMemberIds.has(m.member_id)) {
        unmanaged.push(`squad/${manifest.squad.name} 多出成员 ${m.member_id}`);
      }
      if (sDrift.length === 0 && !memberAction && !created.some((c) => c.startsWith("squad/"))) unchanged.push(`squad/${manifest.squad.name}`);
    }
    for (const rs of remoteSquads) if (rs.name !== manifest.squad.name) unmanaged.push(`squad/${rs.name}`);

    // --- 5. Project reconcile ---
    const remoteProjects = runJson([...MC, "project", "list", ...WS, "--output", "json"], "project list", undefined, { transient: true }) as Array<Record<string, any>>;
    const project = remoteProjects.find((p) => p.title === manifest.project.title);
    if (project) {
      overlay.project = project.id;
      const description = manifest.project.description;
      // 未声明 description 时保持兼容，不收敛远端已有描述；声明后精确比对并更新漂移。
      if (description !== undefined && (project.description ?? "") !== description) {
        if (dryRun) {
          updated.push(`project/${manifest.project.title} (description)`);
        } else {
          runJson([...MC, "project", "update", ...WS, project.id, "--description", description, "--output", "json"], "project update description");
          updated.push(`project/${manifest.project.title} (description)`);
        }
      } else {
        unchanged.push(`project/${manifest.project.title}`);
      }
    } else if (dryRun) {
      created.push(`project/${manifest.project.title}`);
    } else {
      const cp = runJson([...MC, "project", "create", ...WS, "--title", manifest.project.title,
        ...(manifest.project.description !== undefined ? ["--description", manifest.project.description] : []),
        "--output", "json"], "project create") as any;
      const id = cp.id ?? cp.project?.id;
      if (!id) throw new UnknownError("project create 输出缺 id");
      overlay.project = id;
      created.push(`project/${manifest.project.title}`);
    }
    for (const rp of remoteProjects) if (rp.title !== manifest.project.title) unmanaged.push(`project/${rp.title}`);

    // TFS Sync 的目标 Project Title 由当前分组 manifest 管理；其他 Custom Env 保持原值。
    const syncAgentId = agentIds["TFS Sync Agent"];
    if (syncAgentId) {
      const envArgs = [...MC, "agent", "env"];
      const readEnv = () => {
        const out = runJson([...envArgs, "get", syncAgentId, ...WS, "--output", "json"], "读取 TFS Sync Agent 环境", undefined, { transient: true }) as { custom_env?: Record<string, string> };
        const env = out.custom_env ?? {};
        if (typeof env !== "object" || Array.isArray(env)) throw new UnknownError("TFS Sync Agent custom_env 不可识别");
        return env;
      };
      const current = readEnv();
      const title = manifest.project.title;
      const label = "agent/TFS Sync Agent (RONDO_PROJECT_TITLE)";
      if (current.RONDO_PROJECT_TITLE === title) unchanged.push(label);
      else {
        if (!dryRun) {
          const desired = { ...current, RONDO_PROJECT_TITLE: title };
          runJsonStdin([...envArgs, "set", syncAgentId, ...WS, "--custom-env-stdin", "--output", "json"], "设置 TFS Sync Agent Project Title", JSON.stringify(desired));
          if (readEnv().RONDO_PROJECT_TITLE !== title) throw new UnknownError("RONDO_PROJECT_TITLE 回读不一致");
        }
        updated.push(label);
      }
    }

    // --- 6. Autopilot reconcile（run_only；trigger 一律不加——MG-5 安全纪律） ---
    const apListOut = runJson([...MC, "autopilot", "list", ...WS, "--output", "json"], "autopilot list", undefined, { transient: true }) as any;
    const remoteAps = (Array.isArray(apListOut) ? apListOut : apListOut.autopilots ?? []) as Array<Record<string, any>>;
    for (const ap of manifest.autopilots) {
      const prompt = readText(join(REPO_ROOT, ap.prompt_file), `autopilot ${ap.title} prompt`).trim();
      const hit = remoteAps.find((x) => x.title === ap.title);
      if (!hit) {
        if (dryRun) {
          created.push(`autopilot/${ap.title}`);
        } else {
          runJson(
            [...MC, "autopilot", "create", ...WS, "--agent", agentIds[ap.agent], "--mode", ap.mode,
              "--title", ap.title, "--description", prompt, "--output", "json"],
            `autopilot create ${ap.title}`,
          );
          created.push(`autopilot/${ap.title}`);
        }
        continue;
      }
      const apDrift: string[] = [];
      if (!sameText(hit.description ?? "", prompt)) apDrift.push("description");
      if (hit.execution_mode !== ap.mode) apDrift.push("mode");
      if (agentIds[ap.agent] && hit.assignee_id !== agentIds[ap.agent]) apDrift.push("agent");
      if (apDrift.length > 0) {
        if (dryRun) {
          updated.push(`autopilot/${ap.title} (${apDrift.join(",")})`);
        } else {
          const cmd = [...MC, "autopilot", "update", ...WS, hit.id, "--output", "json"];
          if (apDrift.includes("description")) cmd.push("--description", prompt);
          if (apDrift.includes("mode")) cmd.push("--mode", ap.mode);
          if (apDrift.includes("agent")) cmd.push("--agent", agentIds[ap.agent]);
          runJson(cmd, `autopilot update ${ap.title}`);
          updated.push(`autopilot/${ap.title} (${apDrift.join(",")})`);
        }
      } else {
        unchanged.push(`autopilot/${ap.title}`);
      }
    }
    const manifestApTitles = new Set(manifest.autopilots.map((a) => a.title));
    for (const ra of remoteAps) if (!manifestApTitles.has(ra.title)) unmanaged.push(`autopilot/${ra.title}`);

    // --- 6.5 Workflow 自定义状态 reconcile（只增不删不改序；本段失败不阻断前段成果，归并 exit 3） ---
    let workflowUnknown: string | null = null;
    if (workflow?.statuses?.length) {
      const wfResult = reconcileWorkflowStatuses(workflow, {
        dryRun,
        wsArgs: WS,
        cliArgs: SRV,
        versionOf: () => runCommand([...MC, "--version"]).stdout,
        runJsonFn: (cmd, what) => runJson(cmd, what),
        log,
      });
      created.push(...wfResult.created);
      unchanged.push(...wfResult.unchanged);
      unmanaged.push(...wfResult.unmanaged);
      if (wfResult.status === "unknown") workflowUnknown = wfResult.reason ?? "workflow reconcile UNKNOWN";
    }

    // --- 7. overlay 原子写 ---
    if (!workflowUnknown) delete overlay.provisioning_required;
    const overlayWritten = writeOverlay();

    // --- 8. 输出 ---
    process.stdout.write(JSON.stringify({
      result: workflowUnknown ? "UNKNOWN" : check && (created.length || updated.length) ? "DRIFT" : "PASS",
      workspace: args.workspace,
      workspace_id: overlay.workspace_id,
      mode: check ? "check" : dryRun ? "dry-run" : "provision",
      created, updated, unchanged, unmanaged_remote: unmanaged,
      workflow_unknown: workflowUnknown,
      workflow_skipped: skipWorkflow,
      overlay_written: overlayWritten,
      ...(mcpSpecs.length ? { mcp_configuration: "WRITE_ONLY_NOT_VERIFIED", mcp_runtime: "NOT_RUN" } : {}),
      next: dryRun ? null : `rondo workspace sync --workspace ${args.workspace}${overlay.multica_profile ? ` --profile ${overlay.multica_profile}` : ""}`,
    }, null, 2) + "\n");
    return workflowUnknown ? 3 : check && (created.length || updated.length) ? 2 : 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      const overlayWritten = writeOverlay();
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN", reason: exc.message,
        workspace: args.workspace, created, updated, unchanged, unmanaged_remote: unmanaged,
        workflow_skipped: skipWorkflow,
        overlay_written: overlayWritten,
      }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=workspace；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerWorkspaceProvision(group: Command): void {
  group
    .command("provision")
    .description("根据配置供给并核对 Multica Workspace 资源")
    .usage("--workspace <name> [--slug <slug>] [--create-workspace [--display-name <name>]] [--runtime-id <uuid>] [--profile <name>] [--dry-run | --check] [--skip-workflow] [--mcp-only] [--update-mcp <names>]")
    .addHelpText("after", "\n--dry-run / --check 仅预览或检查；--mcp-only 仅处理 MCP。")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(main(cmd.args));
    });
}
