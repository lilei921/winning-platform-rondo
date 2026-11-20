import { isUtf8 } from "node:buffer";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FailError, UnknownError } from "../../cli/errors.js";
import { readGitBlob, readGitTree } from "../../clients/git-tree.js";
import { normalizeContractText } from "../delivery/contract-files.js";
import { git, gitOk, withTemporaryIndex } from "../../clients/git.js";

/** Git represents an absent directory as the empty tree for a three-way Change merge. */
export function changeTree(root: string, revision: string, path: string): string {
  const entry = gitOk(root, ["ls-tree", revision, "--", path], "读取 Change Git Tree");
  if (!entry) return gitOk(root, ["mktree"], "取得空 Git Tree");
  const match = /^040000 tree ([0-9a-f]{40})\t/.exec(entry);
  if (!match) throw new FailError(`Change 路径不是 Git 目录: ${revision}:${path}`);
  return match[1];
}

/** Only newly checked boxes may differ; keep the line numbers for a two-sided progress merge. */
function addedTaskChecks(baseBlob: Buffer, candidateBlob: Buffer): number[] | undefined {
  if (![baseBlob, candidateBlob].every(blob => isUtf8(blob) && !blob.includes(0))) return;
  const base = baseBlob.toString("utf8"), candidate = candidateBlob.toString("utf8");
  if (normalizeContractText("tasks.md", base) !== normalizeContractText("tasks.md", candidate)) return;
  const checked = /^\s*-\s*\[[xX]\]/;
  const before = base.split(/\r\n|\r|\n/), after = candidate.split(/\r\n|\r|\n/);
  const added: number[] = [];
  for (let i = 0; i < before.length; i++) {
    const wasChecked = checked.test(before[i]), isChecked = checked.test(after[i]);
    if (wasChecked && !isChecked) return;
    if (!wasChecked && isChecked) added.push(i);
  }
  return added;
}

/** Reconcile committed work with the approved contract on a divergent Runtime. */
export function developmentTree(root: string, path: string, original: string, local: string, approved: string): string {
  const originalFiles = readGitTree(root, original, "");
  const localFiles = readGitTree(root, local, "");
  const approvedFiles = readGitTree(root, approved, "");
  const imported = ["tasks.md", "design.md"].filter(name => {
    const old = originalFiles.get(name), from = approvedFiles.get(name), edited = localFiles.get(name);
    if (!from || !edited || old?.oid === from.oid || old?.oid === edited.oid || from.mode !== edited.mode) return false;
    if (name === "design.md") return !old;
    return addedTaskChecks(readGitBlob(root, from.oid), readGitBlob(root, edited.oid)) !== undefined;
  });
  const base = imported.length ? withTemporaryIndex(root, index => {
    index(["read-tree", original]);
    for (const name of imported) {
      const { mode, oid } = approvedFiles.get(name)!;
      index(["update-index", "--add", "--cacheinfo", mode, oid, name]);
    }
    return index(["write-tree"]);
  }) : original;
  return mergeChangeTrees(root, path, base, local, approved, true);
}

/** Git may report a textual conflict for independent checkmarks on adjacent tasks. Resolve
 * just that blob in Git's merge result, retaining the remote formatting and other merged files. */
function resolveTaskProgress(root: string, base: string, local: string, remote: string, merged: string): string | undefined {
  const task = (tree: string) => readGitTree(root, tree, "").get("tasks.md");
  const original = task(base), ours = task(local), theirs = task(remote);
  if (!original || !/^(100644|100755)$/.test(original.mode) ||
      ours?.mode !== original.mode || theirs?.mode !== original.mode) return;
  const [baseBlob, localBlob, remoteBlob] = [original, ours, theirs].map(entry => readGitBlob(root, entry.oid));
  const progress = addedTaskChecks(baseBlob, localBlob);
  if (!progress || !addedTaskChecks(baseBlob, remoteBlob)) return;
  const lines = remoteBlob.toString("utf8").split(/(\r\n|\r|\n)/);
  for (const i of progress) lines[2 * i] = lines[2 * i].replace(/^(\s*-\s*\[) (\])/, "$1x$2");
  return withTemporaryIndex(root, (index, dir) => {
    const file = join(dir, "tasks.md");
    writeFileSync(file, lines.join(""));
    const oid = index(["hash-object", "-w", "--no-filters", file]);
    index(["read-tree", merged]);
    index(["update-index", "--cacheinfo", original.mode, oid, "tasks.md"]);
    return index(["write-tree"]);
  });
}

/** Merge only the Change directory; even a remote rename outside it cannot change a sibling. */
export function mergeChangeTrees(root: string, path: string, base: string, local: string, remote: string, development = false): string {
  if (remote === base || remote === local) return local;
  if (local === base) return remote;
  const merged = git(root, ["merge-tree", "--write-tree", "--name-only", "-z", "--merge-base=" + base, remote, local]);
  if (merged.status === 0) return merged.stdout.split("\0")[0].trim();
  if (merged.status !== 1) throw new UnknownError("三方合并 Change 失败: " + merged.stderr);
  const [tree, ...paths] = merged.stdout.split("\0\0", 1)[0].split("\0");
  const tasks = paths.indexOf("tasks.md");
  if (development && tasks >= 0) {
    const resolved = resolveTaskProgress(root, base, local, remote, tree);
    if (resolved) {
      paths.splice(tasks, 1);
      if (!paths.length) return resolved;
    }
  }
  const diff = gitOk(root, ["--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
    remote, local, "--", ...paths], "读取冲突差异");
  throw new FailError(`Change 内容冲突: ${paths.map(p => path + "/" + p).join(", ")}\n远端 ${remote} / 本地 ${local}\n${diff.slice(0, 8000)}`);
}

/** Graft the merged subtree onto the remote revision with a disposable index. */
export function publishedTree(root: string, revision: string, path: string, subtree: string): string {
  return withTemporaryIndex(root, index => {
    index(["read-tree", revision]);
    index(["rm", "--cached", "--force", "--quiet", "-r", "--ignore-unmatch", "--", path]);
    index(["read-tree", "--prefix=" + path + "/", subtree]);
    return index(["write-tree"]);
  });
}
