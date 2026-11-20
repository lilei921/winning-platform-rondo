/**
 * clients/repo-root.ts — projects/multica 根目录定位。
 *
 * 包经 npm pack 全局安装后，模块位于全局 node_modules，不能再用 import.meta.url 回推仓内路径
 *（npm link 场景下符号链接解析恰好掩盖了这一点）。解析顺序：
 *   1. MULTICA_REPO_ROOT 环境变量（显式覆盖，指向 monorepo 根）；
 *   2. 从 cwd 逐级上溯，以 projects/multica/workspace-skills/_shared 目录存在为标记。
 * 解析失败一律 UnknownError（exit 3）。
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UnknownError } from "../cli/errors.js";

const MARKER = join("projects", "multica", "workspace-skills", "_shared");

export function resolveMulticaRoot(): { multicaRoot: string; monorepoRoot: string } {
  const envRoot = process.env.MULTICA_REPO_ROOT?.trim();
  if (envRoot) {
    const abs = resolve(envRoot);
    if (!existsSync(join(abs, MARKER))) {
      throw new UnknownError(`MULTICA_REPO_ROOT 无效（缺少标记目录 ${MARKER}）: ${abs}`);
    }
    return { multicaRoot: join(abs, "projects", "multica"), monorepoRoot: abs };
  }
  let dir = resolve(process.cwd());
  for (;;) {
    if (existsSync(join(dir, MARKER))) {
      return { multicaRoot: join(dir, "projects", "multica"), monorepoRoot: dir };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new UnknownError(
    `无法定位 monorepo 根：从 cwd(${process.cwd()}) 上溯未找到标记目录 ${MARKER}——请在 monorepo 内执行，或设置 MULTICA_REPO_ROOT 环境变量`,
  );
}
