/** workspace sync-skills — 同步受管 Skill 资产并回读确认。 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Command } from "commander";
import { UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { runCommand, runJson, runJsonStdin } from "../../clients/spawn.js";
import { bindEnvironment, multicaPrefix, type MulticaEnvironment } from "../../clients/multica-environment.js";
import { resolveMulticaRoot } from "../../clients/repo-root.js";
import { readSkillContent } from "./skill-content.js";
import { validateSkillReferences } from "./skill-refs.js";

// 根定位见 clients/repo-root.ts（npm pack 全局安装后不能按包内位置回推）。
// 模块级可变绑定由 main() 开头的 initRoots() 填充，helper 函数引用。
let REPO_ROOT = "";
let CONFIG_ROOT = "";
let SKILLS_ROOT = "";
function initRoots(): void {
  const r = resolveMulticaRoot();
  REPO_ROOT = r.multicaRoot;
  CONFIG_ROOT = join(REPO_ROOT, "workspace-config");
  SKILLS_ROOT = join(REPO_ROOT, "skills");
}

interface Overlay extends MulticaEnvironment {
  provisioning_required?: string[];
  workspace_id?: string;
  skills?: Record<string, string>;
}

function log(msg: string): void { process.stderr.write(msg + "\n"); }

function readJson(path: string, what: string): any {
  if (!existsSync(path)) throw new UnknownError(`${what} 不存在: ${path}`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (exc) { throw new UnknownError(`${what} 不是合法 JSON (${path}): ${exc}`); }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** 仓内 Skill 清单：skills/ 下排除 _shared 的目录；SKILL.md = content，其余文件全量 = skill files */
function listSkillFiles(skill: string): string[] {
  const dir = join(SKILLS_ROOT, skill);
  if (!existsSync(dir)) throw new UnknownError(`Skill 目录不存在: ${dir}`);
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.filter((p) => p !== "SKILL.md");
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

function main(rawArgs: string[]): number {
  const args = parseArgs(rawArgs);
  if (typeof args.workspace !== "string" || !args.workspace) {
    process.stderr.write(
      "用法: rondo workspace sync-skills --workspace <name> [--skill <name>] [--profile <name>] [--dry-run]\n",
    );
    return 64;
  }
  if (Object.keys(args).some(key => !["workspace", "skill", "profile", "dry-run", "check"].includes(key))) {
    process.stderr.write("workspace sync-skills 存在未知参数\n");
    return 64;
  }
  const dryRun = args["dry-run"] === true;
  // --profile：multica 配置 profile（云端/97 等多环境，自带 server_url+token）；缺省走 CLI 默认 profile
  let MC: string[] = [];
  const checkMode = args.check === true;

  try {
    initRoots();
    const overlayPath = join(CONFIG_ROOT, "workspaces", `${args.workspace}.json`);
    const overlay = readJson(overlayPath, `工作区 overlay ${args.workspace}`) as Overlay;

    if (overlay.provisioning_required?.length) {
      throw new UnknownError(`工作区需先 provision 补齐 Skills: ${overlay.provisioning_required.join(", ")}`);
    }
    if ((args.profile !== undefined || process.env.RONDO_MULTICA_PROFILE) && !overlay.multica_server_url) {
      throw new UnknownError("overlay 尚未绑定环境；请先用指定 profile 执行 workspace provision");
    }
    // 预演保持零平台调用；显式 profile 必须先由 provision 绑定。
    if (dryRun) {
      if (args.profile !== undefined && args.profile !== overlay.multica_profile) {
        throw new UnknownError("离线同步的 profile 未绑定；请先为该环境执行 workspace provision");
      }
    } else {
      Object.assign(overlay, bindEnvironment(overlay, args.profile, prefix => {
        const cp = runCommand([...prefix, "config", "show"]);
        if (cp.status !== 0) throw new UnknownError("multica config show 失败");
        return process.env.MULTICA_SERVER_URL || /^server_url:\s*(\S+)$/m.exec(cp.stdout)?.[1] || "";
      }));
    }
    MC = multicaPrefix({ multica_cli: "multica", ...overlay });
    // 全量同步前发现旧 overlay 缺少受管 Skills 时停止；不能静默发布不完整的 Analyst。
    const manifestPath = join(CONFIG_ROOT, "provisioning.json");
    if (args.skill === undefined && existsSync(manifestPath)) {
      const managed = readJson(manifestPath, "provisioning manifest").managed_skills as string[];
      const missing = managed.filter(name => !overlay.skills?.[name]);
      if (missing.length) throw new UnknownError(`overlay 缺少受管 Skills: ${missing.join(", ")}；先运行 workspace provision`);
    }

    // 范围：overlay.skills 已登记的 Skill；--skill 进一步收窄
    const registered = Object.keys(overlay.skills ?? {});
    let scope = registered;
    if (typeof args.skill === "string") {
      if (!registered.includes(args.skill)) {
        throw new UnknownError(`Skill ${args.skill} 未在 overlay ${args.workspace} 的 skills 映射登记`);
      }
      scope = [args.skill];
    }

    {
      // M6 发布前闸（F6 防复发）：references 引用完整性——包内引用必须包内存在，
      // 跨包引用必须在 skillsRoot 存在；--dry-run 只报告不阻断，正式同步/检测列全量后阻断
      const refProblems = scope.flatMap((s) => validateSkillReferences(SKILLS_ROOT, s));
      if (refProblems.length > 0) {
        const report = refProblems.map((p) => `  ${p.skill}/${p.file} -> ${p.ref}（${p.kind}）`).join("\n");
        if (dryRun) log(`references 引用问题 ${refProblems.length} 处（dry-run 仅报告）:\n${report}`);
        else throw new UnknownError(`Skill references 引用缺页 ${refProblems.length} 处，阻断发布：\n${report}`);
      }
    }

    if (!overlay.workspace_id) throw new UnknownError("overlay 缺少 workspace_id");

    const skippedUnregistered = readdirSync(SKILLS_ROOT)
      .filter((d) => statSync(join(SKILLS_ROOT, d)).isDirectory())
      .filter((d) => !registered.includes(d));

    if (dryRun) {
      process.stdout.write(JSON.stringify({
        result: "PASS",
        workspace: args.workspace,
        mode: "dry-run",
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return 0;
    }

    // --- 平台同步 / 检测 ---
    // 显式 workspace 纪律（红线 2）：skill 各子命令按 CLI 默认工作区解析，跨工作区必须显式带 --workspace-id
    const WS = ["--workspace-id", overlay.workspace_id as string];


    const synced: string[] = [];
    const deletedRemote: string[] = [];
    const mismatches: string[] = [];
    const drifts: string[] = [];
    const unchangedFiles: string[] = [];
    for (const skill of scope) {
      const skillId = (overlay.skills as Record<string, string>)[skill];
      const skillDir = join(SKILLS_ROOT, skill);
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) throw new UnknownError(`Skill ${skill} 缺 SKILL.md`);
      const skillContent = readSkillContent(skillMd);
      const skillMdHash = sha256(Buffer.from(skillContent, "utf8"));

      const paths = listSkillFiles(skill);
      const localByPath = new Map<string, { content: string; hash: string; size: number }>();
      for (const rel of paths) {
        const content = readSkillContent(join(skillDir, rel));
        const buf = Buffer.from(content, "utf8");
        localByPath.set(rel, { content, hash: sha256(buf), size: buf.length });
      }

      // 回读平台实际状态（回读式 diff 的唯一比对依据；SKILL.md 经 skill get 的 content_hash 比对）
      const getOut = runJson([...MC, "skill", "get", skillId, ...WS, "--output", "json"], `skill get ${skill}`, undefined, { transient: true }) as Record<string, any>;
      const preListOut = runJson([...MC, "skill", "files", "list", skillId, ...WS, "--output", "json"], `files list ${skill}`, undefined, { transient: true }) as any;
      const preRemote = (Array.isArray(preListOut) ? preListOut : preListOut.files ?? []) as Array<Record<string, any>>;
      const preByPath = new Map(preRemote.map((rf) => [rf.path, rf]));

      if (checkMode) {
        if (typeof getOut.content_hash === "string" && getOut.content_hash !== skillMdHash) {
          drifts.push(`${skill}/SKILL.md: 内容不符（平台 ${getOut.content_hash.slice(0, 12)}… != 仓内 ${skillMdHash.slice(0, 12)}…）`);
        }
        for (const [rel, f] of localByPath) {
          const rf = preByPath.get(rel);
          if (!rf) drifts.push(`${skill}/${rel}: 平台缺失（待 upsert）`);
          else if (typeof rf.content_hash === "string" && rf.content_hash !== f.hash) {
            drifts.push(`${skill}/${rel}: 内容不符（平台 ${rf.content_hash.slice(0, 12)}… != 仓内 ${f.hash.slice(0, 12)}…）`);
          }
        }
        for (const rf of preRemote) if (!localByPath.has(rf.path)) drifts.push(`${skill}/${rf.path}: 平台多余（待 delete）`);
        continue;
      }

      // hash 预比对：未变化跳过（provisioning 方案 §1.3；语义不变，末尾回读校验保留）
      if (typeof getOut.content_hash === "string" && getOut.content_hash === skillMdHash) {
        log(`${skill}/SKILL.md: 未变化，跳过 update`);
        unchangedFiles.push(`${skill}/SKILL.md`);
      } else {
        runJsonStdin([...MC, "skill", "update", skillId, ...WS, "--content-stdin", "--output", "json"], `skill update ${skill}`, skillContent);
      }
      for (const [rel, f] of localByPath) {
        const rf = preByPath.get(rel);
        if (rf && typeof rf.content_hash === "string" && rf.content_hash === f.hash) {
          log(`${skill}/${rel}: 未变化，跳过 upsert`);
          unchangedFiles.push(`${skill}/${rel}`);
          continue;
        }
        runJsonStdin(
          [...MC, "skill", "files", "upsert", skillId, ...WS, "--path", rel, "--content-stdin", "--output", "json"],
          `files upsert ${skill}/${rel}`, f.content,
        );
      }

      // reconcile + 回读校验（post list：以上写入后的平台实际状态）
      const listOut = runJson([...MC, "skill", "files", "list", skillId, ...WS, "--output", "json"], `files list ${skill}`, undefined, { transient: true }) as any;
      const remoteFiles = (Array.isArray(listOut) ? listOut : listOut.files ?? []) as Array<Record<string, any>>;
      for (const rf of remoteFiles) {
        const local = localByPath.get(rf.path);
        if (!local) {
          // files delete 无 --output flag（0.6.1 实测），按退出码判定
          const del = runCommand([...MC, "skill", "files", "delete", skillId, ...WS, rf.id]);
          if (del.status !== 0) {
            throw new UnknownError(`files delete ${skill}/${rf.path} 命令失败 rc=${del.status}: ${del.stderr.trim() || del.stdout.trim()}`);
          }
          deletedRemote.push(`${skill}/${rf.path}`);
        } else if (typeof rf.content_hash === "string" && rf.content_hash !== local.hash) {
          mismatches.push(`${skill}/${rf.path}: content_hash 不符（remote ${rf.content_hash.slice(0, 12)}… != local ${local.hash.slice(0, 12)}…）`);
        } else if (typeof rf.size === "number" && rf.size !== local.size) {
          mismatches.push(`${skill}/${rf.path}: size 不符（remote ${rf.size} != local ${local.size}）`);
        }
      }
      synced.push(skill);
    }

    if (checkMode) {
      process.stdout.write(JSON.stringify({
        result: drifts.length > 0 ? "DRIFT" : "PASS",
        workspace: args.workspace,
        mode: "check",
        checked: scope,
        drifts,
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return drifts.length > 0 ? 2 : 0;
    }

    if (mismatches.length > 0) {
      process.stdout.write(JSON.stringify({
        result: "UNKNOWN",
        reason: "回读校验不符（如实列明；修复后重跑本脚本幂等）",
        workspace: args.workspace,
        synced,
        deleted_remote: deletedRemote,
        mismatches,
        skipped_unregistered: skippedUnregistered,
      }, null, 2) + "\n");
      return 3;
    }
    process.stdout.write(JSON.stringify({
      result: "PASS",
      workspace: args.workspace,
      synced,
      deleted_remote: deletedRemote,
      unchanged_files: unchangedFiles.length,
      skipped_unregistered: skippedUnregistered,
    }, null, 2) + "\n");
    return 0;
  } catch (exc) {
    if (exc instanceof UnknownError) {
      process.stdout.write(JSON.stringify({ result: "UNKNOWN", reason: exc.message }, null, 2) + "\n");
      log(`UNKNOWN: ${exc.message}`);
      return 3;
    }
    throw exc;
  }
}

/** commander 注册：group=workspace；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerWorkspaceSyncSkills(group: Command): void {
  group
    .command("sync-skills")
    .description("同步 Skill 资产")
    .usage("--workspace <name> [--skill <name>] [--profile <name>] [--dry-run] [--check]")
    .addHelpText("after", "\n--check 检查差异；--dry-run 预览。")
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      throw new ExitSignal(main(cmd.args));
    });
}
