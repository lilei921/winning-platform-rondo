/** 只读检查调用方明确传入的根仓；执行者授权由具体写操作负责。 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { UnknownError } from "../cli/errors.js";
import { validateRootRepo } from "./runtime-paths.js";

/** 由 Git 确认工作树根目录，兼容普通 checkout 与 linked worktree，不依赖平台目录布局。 */
export function validateNativeCheckout(root: string): { rootRepo: string } {
  const rootRepo = validateRootRepo(root, "--root-repo");
  try {
    if (!statSync(join(rootRepo, "AGENTS.md")).isFile()) throw new Error();
  } catch {
    throw new UnknownError("根仓规范 AGENTS.md 尚不可读或不是文件");
  }
  return { rootRepo };
}
