/**
 * change resolve-identity — OpenSpec Change Identity 确定性只读解析器。
 *
 * 契约：05-openspec-schema-implementation-design §5.2/§5.3/§5.6
 * （裁决 D1：05 §5.2/§18 的 resolve-openspec-change.py 落地为 TS；
 * 裁决 D3 修订：自 rondo 收编起，实现位置为 @winning/skill-flow 包内
 * commands/change/resolve-identity.ts，原 projects/multica/scripts/ 路径
 * 在迁移窗口期保持有效，见 change-progress-script-contract.md addendum）。
 *
 * 只读：不创建 / 不修改任何 Change 与 Multica 事实。
 *
 * 用法：
 *   rondo change resolve-identity --openspec-root <root>
 *     [--change-ref <stable-change-id>] [--tfs-id <id>] [--expect-schema <name>]
 *
 * 结果枚举 → 退出码：
 *   ACTIVE_FOUND / ARCHIVED_FOUND / NOT_FOUND → 0（合法确定性答案）
 *   CONFLICT（>1 合法候选，禁止取第一个）      → 2
 *   INVALID（候选损坏 / schema 与 expect 不符） → 2
 *   未预期 IO / 环境错误                        → 3（此时 result 固定为 INVALID，语义以退出码为准）
 *   参数用法错误                                → 64
 * stdout 只出 JSON；日志走 stderr。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { Command } from "commander";
import { emitJson, log, markLeafExecuted } from "../../cli/output.js";
import { UnknownError } from "../../cli/errors.js";
import { resolveOpenspecRootDir } from "../../clients/runtime-paths.js";

type Result = "ACTIVE_FOUND" | "ARCHIVED_FOUND" | "NOT_FOUND" | "CONFLICT" | "INVALID";

interface Candidate {
  id: string;
  path: string;
  archived: boolean;
  schema: string | null;
}

interface Answer {
  result: Result;
  change_ref: string | null;
  path: string | null;
  archived: boolean;
  schema: string | null;
  detail?: string;
  candidates?: Candidate[];
}

const LOG_PREFIX = "resolve-change-identity";

function emit(answer: Answer, exitCode: number): never {
  emitJson(answer, exitCode);
}

function usage(message: string): never {
  log(LOG_PREFIX, message);
  emit(
    {
      result: "INVALID",
      change_ref: null,
      path: null,
      archived: false,
      schema: null,
      detail: `usage: ${message}`,
    },
    64,
  );
}

function failUnexpected(message: string): never {
  log(LOG_PREFIX, message);
  emit(
    { result: "INVALID", change_ref: null, path: null, archived: false, schema: null, detail: `unexpected: ${message}` },
    3,
  );
}

// --- args ---

interface Args {
  openspecRoot: string;
  changeRef: string | null;
  tfsId: string | null;
  expectSchema: string | null;
}

function parseArgs(argv: string[]): Args {
  let openspecRoot: string | null = null;
  let changeRef: string | null = null;
  let tfsId: string | null = null;
  let expectSchema: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) usage(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--openspec-root": openspecRoot = next(); break;
      case "--change-ref": changeRef = next(); break;
      case "--tfs-id": tfsId = next(); break;
      case "--expect-schema": expectSchema = next(); break;
      case "--output":
        if (next() !== "json") usage("--output only supports json");
        break;
      case "--help": case "-h":
        process.stdout.write(
          "usage: rondo change resolve-identity --openspec-root <root> [--change-ref <id>] [--tfs-id <id>] [--expect-schema <name>] [--output json]\n",
        );
        process.exit(0);
      default:
        usage(`unknown argument: ${a}`);
    }
  }
  if (!openspecRoot) usage("--openspec-root is required");
  if (!changeRef && !tfsId) usage("at least one of --change-ref / --tfs-id is required");
  if (changeRef && /[\\/]/.test(changeRef)) usage("--change-ref 传稳定 Change ID，不传路径");
  if (tfsId && !/^\d+$/.test(tfsId)) usage("--tfs-id 必须是数字");
  return {
    openspecRoot: resolve(openspecRoot!),
    changeRef,
    tfsId,
    expectSchema,
  };
}

// --- change dir inspection ---

/** 读取候选目录的 schema（.openspec.yaml 的 `schema:` 字段）；目录不存在返回 null，损坏抛错。 */
function inspectCandidate(dir: string, id: string, archived: boolean, root: string): Candidate | null {
  if (!existsSync(dir)) return null;
  let st;
  try {
    st = statSync(dir);
  } catch (e) {
    throw new Error(`cannot stat ${dir}: ${(e as Error).message}`);
  }
  if (!st.isDirectory()) return null;
  const metaPath = join(dir, ".openspec.yaml");
  if (!existsSync(metaPath)) {
    throw new Error(`candidate ${id} 缺少 .openspec.yaml（metadata 损坏）`);
  }
  const raw = readFileSync(metaPath, "utf8");
  const m = raw.match(/^\s*schema:\s*"?([^"\n]+?)"?\s*$/m);
  return {
    id,
    path: isAbsolute(dir) ? dir : resolve(root, dir),
    archived,
    schema: m ? m[1] : null,
  };
}

/** 两种身份均已提供时，已存在的 change_ref 必须与 tfs.id 的稳定后缀一致。
 * 旧 change_ref 路径不存在时仍允许 Recovery Lookup 按 tfs.id 恢复。 */
function identityConflict(c: Candidate, args: Args): string | null {
  if (args.changeRef === c.id && args.tfsId && !c.id.endsWith(`-${args.tfsId}`)) {
    return `change_ref=${c.id} 与 tfs.id=${args.tfsId} 冲突，禁止接受或恢复为其他身份`;
  }
  return null;
}

/** 校验候选 schema 与 --expect-schema；不符返回错误消息，否则 null。 */
function schemaViolation(c: Candidate, expectSchema: string | null): string | null {
  if (!expectSchema) return null;
  if (c.schema !== expectSchema) {
    return `candidate ${c.id} schema=${c.schema ?? "(missing)"} 与 --expect-schema ${expectSchema} 不符`;
  }
  return null;
}

function answerFrom(c: Candidate, result: "ACTIVE_FOUND" | "ARCHIVED_FOUND"): Answer {
  return { result, change_ref: c.id, path: c.path, archived: c.archived, schema: c.schema };
}

// --- archive 目录名：剥脱 YYYY-MM-DD- 日期前缀（05 §5.3，本仓实证命名） ---

const ARCHIVE_PREFIX = /^\d{4}-\d{2}-\d{2}-(.+)$/;

function logicalId(dirName: string, archived: boolean): string {
  if (!archived) return dirName;
  const m = dirName.match(ARCHIVE_PREFIX);
  return m ? m[1] : dirName;
}

/** 候选是否匹配目标身份：change_ref 精确匹配优先，否则按稳定 TFS ID 后缀匹配（05 §5.1）。 */
function matchesIdentity(logical: string, changeRef: string | null, tfsId: string | null): boolean {
  if (changeRef && logical === changeRef) return true;
  if (tfsId && logical.endsWith(`-${tfsId}`)) return true;
  return false;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

function resolveIn(
  baseDir: string,
  archived: boolean,
  args: Args,
  resultKind: "ACTIVE_FOUND" | "ARCHIVED_FOUND",
): Answer | null {
  const matched: Candidate[] = [];
  const invalidReasons: string[] = [];
  for (const name of listDirs(baseDir)) {
    if (!archived && name === "archive") continue;
    const logical = logicalId(name, archived);
    if (!matchesIdentity(logical, args.changeRef, args.tfsId)) continue;
    let cand: Candidate | null;
    try {
      cand = inspectCandidate(join(baseDir, name), logical, archived, args.openspecRoot);
    } catch (e) {
      invalidReasons.push((e as Error).message);
      continue;
    }
    if (!cand) continue;
    const conflict = identityConflict(cand, args);
    if (conflict) {
      return {
        result: "CONFLICT",
        change_ref: null,
        path: null,
        archived,
        schema: null,
        detail: conflict,
      };
    }
    const v = schemaViolation(cand, args.expectSchema);
    if (v) {
      invalidReasons.push(v);
      continue;
    }
    matched.push(cand);
  }
  if (invalidReasons.length > 0) {
    return {
      result: "INVALID",
      change_ref: null,
      path: null,
      archived,
      schema: null,
      detail: invalidReasons.join("; "),
      candidates: matched,
    };
  }
  if (matched.length > 1) {
    return {
      result: "CONFLICT",
      change_ref: null,
      path: null,
      archived,
      schema: null,
      detail: `${matched.length} 个合法候选，禁止按目录顺序取第一个`,
      candidates: matched,
    };
  }
  if (matched.length === 1) return answerFrom(matched[0], resultKind);
  return null;
}

// --- main ---

function main(rawArgs: string[]): void {
  const args = parseArgs(rawArgs);
  // --openspec-root 语义统一：根仓路径自动归一到其 openspec/ 子目录
  let openspecDir: string;
  try {
    openspecDir = resolveOpenspecRootDir(args.openspecRoot);
  } catch (e) {
    if (e instanceof UnknownError) {
      // resolveOpenspecRootDir 以 changes/ 存在为探测准则，会把「openspec/ 已存在但尚无
      // changes/」的全新根仓首跑误判为定位失败。对只读身份解析器，「尚无任何 Change」的
      // 确定性答案就是 NOT_FOUND（exit 0），与 SKILL「NOT_FOUND 才允许创建」的契约对齐；
      // openspec/ 本身定位不到（根路径传错）仍按 UNKNOWN（exit 3）结构化上报，不掩盖配置错误。
      const inputResolved = resolve(args.openspecRoot);
      const openspecLocated =
        existsSync(join(inputResolved, "openspec")) ||
        (basename(inputResolved) === "openspec" && existsSync(inputResolved));
      if (openspecLocated) {
        log(LOG_PREFIX, "openspec/ 已定位但尚无 changes/ 目录（全新根仓，无任何 Change），按 NOT_FOUND 裁决");
        emit(
          { result: "NOT_FOUND", change_ref: null, path: null, archived: false, schema: null, detail: "openspec/ 已定位但尚无 changes/ 目录（无任何 Change）" },
          0,
        );
      }
      failUnexpected((e as Error).message);
    }
    throw e;
  }
  const changesDir = join(openspecDir, "changes");
  if (!existsSync(changesDir)) {
    failUnexpected(`openspec/changes 不存在：${changesDir}`);
  }

  // 05 §5.2.1 Primary Lookup：persisted change_ref 优先，不每次扫描全量目录。
  if (args.changeRef) {
    const dir = join(changesDir, args.changeRef);
    let cand: Candidate | null = null;
    try {
      cand = inspectCandidate(dir, args.changeRef, false, args.openspecRoot);
    } catch (e) {
      emit(
        { result: "INVALID", change_ref: args.changeRef, path: dir, archived: false, schema: null, detail: (e as Error).message },
        2,
      );
    }
    if (cand) {
      const conflict = identityConflict(cand, args);
      if (conflict) {
        emit({ result: "CONFLICT", change_ref: null, path: null, archived: false, schema: null, detail: conflict }, 2);
      }
      const v = schemaViolation(cand, args.expectSchema);
      if (v) {
        emit({ result: "INVALID", change_ref: cand.id, path: cand.path, archived: false, schema: cand.schema, detail: v }, 2);
      }
      log(LOG_PREFIX, `primary lookup hit: ${cand.id}`);
      emit(answerFrom(cand, "ACTIVE_FOUND"), 0);
    }
    log(LOG_PREFIX, `primary path 不可解析（${dir} 不存在），进入 recovery lookup（active first）`);
  }

  // 05 §5.2.2 Recovery Lookup：active first，排除 archive/。
  const active = resolveIn(changesDir, false, args, "ACTIVE_FOUND");
  if (active) {
    if (active.result === "ACTIVE_FOUND") log(LOG_PREFIX, `recovery lookup hit: ${active.change_ref}（允许 caller 修复 change_ref）`);
    emit(active, active.result === "ACTIVE_FOUND" ? 0 : 2);
  }

  // 05 §5.3 Archive Fallback：active 未找到再查 archive，剥脱日期前缀按逻辑 ID 匹配。
  const archived = resolveIn(join(changesDir, "archive"), true, args, "ARCHIVED_FOUND");
  if (archived) {
    emit(archived, archived.result === "ARCHIVED_FOUND" ? 0 : 2);
  }

  emit(
    { result: "NOT_FOUND", change_ref: null, path: null, archived: false, schema: null, detail: "active 与 archive 均无匹配候选" },
    0,
  );
}

/** commander 注册：group=change；参数解析沿用原脚本实现以保证契约逐字节等价。 */
export function registerResolveIdentity(group: Command): void {
  group
    .command("resolve-identity")
    .description("OpenSpec Change Identity 确定性只读解析（冻结契约 §1）")
    .helpOption(false)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      const cmd = cbArgs[cbArgs.length - 1] as Command;
      main(cmd.args);
    });
}
