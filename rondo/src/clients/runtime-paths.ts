/** 显式根仓路径的本地校验与派生；仓库检出和路径选择由调用方负责。 */

import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { UnknownError } from "../cli/errors.js";
import { logLine } from "../cli/output.js";
import { git } from "./git.js";
import type { BaseRegistryConfig } from "./config.js";

/**
 * --openspec-root 语义统一（0.1.5 起）：一律解释为「根仓路径」，自动归一到其 openspec/ 子目录；
 * 兼容存量直接传 openspec/ 目录的调用（归一为自身，不报错）。
 * 背景：该参数历史上两种实现并存——analysis validate / dev check-completion 按 openspec/ 目录
 * 解释（join(root,"changes")），change resolve-identity / update-progress 按根仓解释
 * （join(root,"openspec","changes")），同名参数两种语义导致误传根仓路径时 Gate 必 FAIL 且
 * 报错路径有误导性（WNDF-8 实测）。
 * 两种解释都定位不到 changes/ → UnknownError（exit 3），报错列出探测过的两个路径。
 */
export function resolveOpenspecRootDir(input: string): string {
  const resolved = resolve(input);
  const asRepoRoot = join(resolved, "openspec");
  if (existsSync(join(asRepoRoot, "changes"))) {
    if (asRepoRoot !== resolved) {
      logLine(`--openspec-root 已归一为 ${asRepoRoot}（传入的是根仓路径）`);
    }
    return asRepoRoot;
  }
  if (existsSync(join(resolved, "changes"))) {
    return resolved;
  }
  throw new UnknownError(
    `--openspec-root 无法定位 OpenSpec 目录：按根仓解释探测 ${asRepoRoot}、按 openspec/ 目录解释探测 ${resolved}，均不含 changes/ 子目录`,
  );
}

export interface RuntimePaths {
  rootRepo: string;
  openspecRoot: string;
  projectId: string;
  daemonId: string | null;
  source: "explicit_arg";
  /** 已核验的根仓远端地址；凭据不在此对象中保存。 */
  gitRemoteUrl?: string;
}

/** 显式 CLI 路径按当前 cwd 归一化；配置或运行环境中的持久根仓仍要求绝对路径。随后校验目录及 Git 根仓。 */
export function validateRootRepo(rootRepo: string, origin: string): string {
  if (origin !== "--root-repo" && !isAbsolute(rootRepo)) {
    throw new UnknownError(`根仓路径不是当前系统语义下的绝对路径（${origin}）: ${rootRepo}`);
  }
  const resolvedRoot = resolve(rootRepo);
  if (!existsSync(resolvedRoot)) {
    throw new UnknownError(`根仓目录不存在（${origin}）: ${resolvedRoot}`);
  }
  // 用 git 自身判定根仓：--show-prefix 为空 = 当前目录即 toplevel。天然免疫 Windows 8.3 短名/
  // 大小写/符号链接差异（§4.6-3/5）；返回值采用 git 给出的规范 toplevel。
  // 仅设置 Git 子进程 cwd，避免 MXC 对只读目录执行 git -C 时拒绝访问；不改变调用方 cwd。
  const top = git(resolvedRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || !top.stdout.trim()) {
    throw new UnknownError(`根仓路径不是 Git 仓（${origin}）: ${resolvedRoot}: ${top.stderr.trim() || top.stdout.trim()}`);
  }
  const prefix = git(resolvedRoot, ["rev-parse", "--show-prefix"]);
  if (prefix.status !== 0 || prefix.stdout.trim() !== "") {
    throw new UnknownError(`根仓路径不是 Git 根仓（指向仓内子目录 ${prefix.stdout.trim() || "?"}，${origin}）: ${resolvedRoot}（git toplevel=${top.stdout.trim()}）`);
  }
  return top.stdout.trim();
}

/** 只消费显式路径，不查询平台挂载或执行身份；need 声明命令实际需要的目录。 */
export function resolveRuntimePaths(
  _cfg: BaseRegistryConfig,
  opts: {
    issue?: { project_id?: string | null };
    projectId?: string;
    rootRepoArg?: string;
    need?: Array<"openspec">;
  },
): RuntimePaths {
  if (!opts.rootRepoArg) throw new UnknownError("必须显式传入 --root-repo，使用本次 checkout 返回的根仓路径");
  const root = validateRootRepo(opts.rootRepoArg, "--root-repo");
  const paths: RuntimePaths = {
    rootRepo: root,
    openspecRoot: join(root, "openspec"),
    projectId: opts.projectId ?? opts.issue?.project_id ?? "",
    daemonId: null,
    source: "explicit_arg",
  };
  if (opts.need?.includes("openspec") && !existsSync(paths.openspecRoot)) {
    throw new UnknownError(`openspec/ 目录不存在: ${paths.openspecRoot}`);
  }
  return paths;
}
