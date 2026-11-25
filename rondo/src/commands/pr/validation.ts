import { realpathSync } from "node:fs";
import { relative, isAbsolute, sep } from "node:path";
import { FailError } from "../../cli/errors.js";
import { gitOk } from "../../clients/git.js";
import { runCommand } from "../../clients/spawn.js";
import { canonicalRepositoryIdentity } from "../delivery/evidence-repository.js";

export class ValidationCommandError extends FailError {
  constructor(message: string, readonly exitCode: number) { super(message); }
}

export function verifyAndExecuteValidation(repoRoot: string, checkout: string, repoUrl: string, candidate: string, command: string[]): void {
  const absoluteRoot = realpathSync(repoRoot);
  const actual = realpathSync(checkout);
  const rel = relative(absoluteRoot, actual);
  if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel) || realpathSync(gitOk(actual, ["rev-parse", "--show-toplevel"], "核对 Validation Git 根")) !== absoluteRoot) throw new FailError("Validation 目录不属于当前授权 Root");
  const origin = gitOk(actual, ["remote", "get-url", "origin"], "读取 Validation 仓库来源");
  if (canonicalRepositoryIdentity(origin) !== canonicalRepositoryIdentity(repoUrl)) throw new FailError("Validation 仓库不等于获批 Repository");
  if (gitOk(actual, ["rev-parse", "HEAD"], "核对实际 Validation Candidate") !== candidate) throw new FailError("Validation Checkout 的 HEAD 与 Candidate 不一致");
  if (gitOk(actual, ["status", "--porcelain", "--untracked-files=no"], "读取 Validation 工作树")) throw new FailError("Validation 工作树含未提交修改，不能证明 Candidate 已验证");
  const check = runCommand(command, actual);
  if (check.status !== 0) throw new ValidationCommandError(`Candidate Validation 失败 rc=${check.status}: ${check.stderr.slice(0, 300)}`, check.status);
  if (gitOk(actual, ["rev-parse", "HEAD"], "复核 Validation Candidate") !== candidate ||
      gitOk(actual, ["status", "--porcelain", "--untracked-files=no"], "复核 Validation 内容")) {
    throw new FailError("Validation 执行期间 Candidate 或工作树发生变化");
  }
}
