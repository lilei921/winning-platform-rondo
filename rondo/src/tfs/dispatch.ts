/**
 * tfs/dispatch.ts —— TFS API 命令分发(承自 tfs-cli index.ts dispatch,降为库)。
 *
 * 参数解析、必填校验、错误消息与 tfs-cli 逐字节一致;
 * 两个消费面:
 *   1. rondo CLI 叶子(query/repo/branch/pr create|get|list/workitem *)——经 runner.ts 映射退出码;
 *   2. flow 层 clients/tfs.ts——进程内调用,FailError 作数据返回(runJson exit-2 等价语义)。
 */

import { cmdQuery } from "./api/query.js";
import { cmdRepoGet, cmdBranchGet } from "./api/repo.js";
import { cmdPrCreate, cmdPrGet, cmdPrList } from "./api/pr.js";
import {
  cmdWorkItemSetState,
  cmdWorkItemComment,
  cmdWorkItemCreate,
  cmdWorkItemLinkCommits,
  cmdWorkItemDownloadAttachment,
} from "./api/workitem.js";

export class UsageError extends Error {}

export interface ParsedArgs {
  _: string[];
  [key: string]: string | boolean | string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function requireStr(args: ParsedArgs, key: string): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) throw new UsageError(`缺少必需参数 --${key}`);
  return v;
}

function optionalStr(args: ParsedArgs, key: string): string | undefined {
  const v = args[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function requireInt(args: ParsedArgs, key: string): number {
  const s = requireStr(args, key);
  const n = Number(s);
  if (!Number.isInteger(n) || n <= 0) throw new UsageError(`--${key} 必须是正整数: ${s}`);
  return n;
}

export async function dispatchTfs(argv: string[]): Promise<unknown> {
  const args = parseArgs(argv);
  const [cmd, sub] = args._;
  if (!cmd || args.help) throw new UsageError("");

  if (cmd === "query") {
    return cmdQuery({ wiql: requireStr(args, "wiql"), project: optionalStr(args, "project") });
  }
  if (cmd === "repo" && sub === "get") {
    return cmdRepoGet({ name: requireStr(args, "name"), project: optionalStr(args, "project") });
  }
  if (cmd === "branch" && sub === "get") {
    return cmdBranchGet({
      repo: requireStr(args, "repo"),
      name: requireStr(args, "name"),
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "pr" && sub === "create") {
    const workItemsRaw = optionalStr(args, "work-items");
    return cmdPrCreate({
      repo: requireStr(args, "repo"),
      source: requireStr(args, "source"),
      target: requireStr(args, "target"),
      title: requireStr(args, "title"),
      descriptionFile: optionalStr(args, "description-file"),
      workItems: workItemsRaw ? workItemsRaw.split(",").map((s) => Number(s.trim())) : undefined,
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "pr" && sub === "get") {
    return cmdPrGet({ id: requireInt(args, "id"), repo: requireStr(args, "repo"), project: optionalStr(args, "project") });
  }
  if (cmd === "pr" && sub === "list") {
    const topRaw = optionalStr(args, "top");
    return cmdPrList({
      repo: requireStr(args, "repo"),
      status: optionalStr(args, "status"),
      sourceBranch: optionalStr(args, "source-branch"),
      top: topRaw ? Number(topRaw) : undefined,
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "workitem" && sub === "set-state") {
    return cmdWorkItemSetState({
      id: requireInt(args, "id"),
      state: requireStr(args, "state"),
      completeWithEstimate: args["complete-with-estimate"] === true,
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "workitem" && sub === "comment") {
    return cmdWorkItemComment({
      id: requireInt(args, "id"),
      textFile: requireStr(args, "text-file"),
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "workitem" && sub === "create") {
    const estimateRaw = optionalStr(args, "estimate");
    const estimate = estimateRaw !== undefined ? Number(estimateRaw) : undefined;
    if (estimate !== undefined && (!Number.isFinite(estimate) || estimate <= 0)) {
      throw new UsageError("--estimate 必须是正数(小时)");
    }
    return cmdWorkItemCreate({
      type: requireStr(args, "type"),
      title: requireStr(args, "title"),
      parent: requireInt(args, "parent"),
      descriptionFile: optionalStr(args, "description-file"),
      estimate,
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "workitem" && sub === "link-commits") {
    const shasRaw = requireStr(args, "sha");
    return cmdWorkItemLinkCommits({
      id: requireInt(args, "id"),
      repo: requireStr(args, "repo"),
      shas: shasRaw.split(",").map((s) => s.trim()).filter(Boolean),
      project: optionalStr(args, "project"),
    });
  }
  if (cmd === "workitem" && sub === "download-attachment") {
    return cmdWorkItemDownloadAttachment({
      url: requireStr(args, "url"),
      out: requireStr(args, "out"),
      name: optionalStr(args, "name"),
    });
  }
  throw new UsageError(`未知命令: ${args._.join(" ")}`);
}
