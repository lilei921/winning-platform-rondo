/**
 * 定位 Multica 配置根目录。支持独立 rondo 仓库与 monorepo 的 projects/multica 布局。
 * 全局安装后不能依赖包自身路径，应从 MULTICA_REPO_ROOT 或 cwd 上溯寻找配置。
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UnknownError } from "../cli/errors.js";

const STANDALONE_MARKER = "workspace-config";
const MONOREPO_MARKER = join("projects", "multica", STANDALONE_MARKER);

function rootsAt(dir: string): { multicaRoot: string; monorepoRoot: string } | null {
  if (existsSync(join(dir, STANDALONE_MARKER))) {
    return { multicaRoot: dir, monorepoRoot: dir };
  }
  if (existsSync(join(dir, MONOREPO_MARKER))) {
    return { multicaRoot: join(dir, "projects", "multica"), monorepoRoot: dir };
  }
  return null;
}

export function resolveMulticaRoot(): { multicaRoot: string; monorepoRoot: string } {
  const envRoot = process.env.MULTICA_REPO_ROOT?.trim();
  if (envRoot) {
    const abs = resolve(envRoot);
    const roots = rootsAt(abs);
    if (!roots) throw new UnknownError(`MULTICA_REPO_ROOT 无效（缺少 workspace-config）: ${abs}`);
    return roots;
  }
  let dir = resolve(process.cwd());
  for (;;) {
    const roots = rootsAt(dir);
    if (roots) return roots;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new UnknownError(`无法定位 Multica 根：从 cwd(${process.cwd()}) 上溯未找到 workspace-config——请在项目仓库内执行，或设置 MULTICA_REPO_ROOT 环境变量`);
}
