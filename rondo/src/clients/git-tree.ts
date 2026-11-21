import { execaSync } from "execa";
import { UnknownError } from "../cli/errors.js";
import { git, gitRuntime } from "./git.js";

/** Paths relative to the requested directory, including links and gitlinks with their Git modes. */
export function readGitTree(root: string, commit: string, dir: string, recursive = false): Map<string, { mode: string; oid: string }> {
  const result = git(root, ["ls-tree", recursive ? "-rz" : "-z", commit + ":" + dir]);
  if (result.status !== 0) throw new UnknownError(`无法读取固定 Git 目录 ${commit}:${dir}: ${result.stderr.trim()}`);
  const entries = new Map<string, { mode: string; oid: string }>();
  for (const record of result.stdout.split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, , oid] = record.slice(0, tab).split(" ");
    entries.set(record.slice(tab + 1), { mode, oid });
  }
  return entries;
}

/** Preserve the exact bytes, including trailing newlines, on Windows and Linux. */
export function readGitBlob(root: string, oid: string): Buffer {
  const runtime = gitRuntime();
  const result = execaSync(runtime.executable, ["cat-file", "blob", oid], {
    cwd: root, env: runtime.env, encoding: "buffer", stripFinalNewline: false,
    maxBuffer: 64 * 1024 * 1024, reject: false,
  });
  if (result.failed) throw new UnknownError(`无法读取 Git Blob ${oid}: ${result.shortMessage ?? ""}`);
  return Buffer.from(result.stdout);
}
