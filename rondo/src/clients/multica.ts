/**
 * clients/multica.ts — multica CLI 统一客户端。
 *
 * 收敛自原各脚本的 Clients 类变体（全仓唯一消费点，plan §4.3）；
 * 命令特化的调用形态用 run() 透传，不在本层展开。
 *
 * M3.2（rll5-replay-remediation-plan）：写命令统一加"回读确认"——写调用抛错
 * （rc≠0 或响应不可解析）时先回读判定副作用是否已生效，生效则按断连恢复返回，
 * 未生效重试一次写、再回读，仍无 → UnknownError 带 [write-unconfirmed]（不猜结果，
 * 保留现场交人工）。happy path = 恰好一次写、零额外读。
 */

import { UnknownError } from "../cli/errors.js";
import { readFileSync } from "node:fs";
import { logLine } from "../cli/output.js";
import { isTransientNetworkText, runJson, runJsonStdin, type RunJsonOptions } from "./spawn.js";
import { multicaPrefix } from "./multica-environment.js";
import type { RuntimeConfig } from "./config.js";

export interface IssueRecord {
  id: string;
  identifier?: string;
  status?: string;
  project_id?: string;
  parent_issue_id?: string | null;
  assignee_id?: string | null;
  metadata?: Record<string, string>;
}

/** issue get 原生响应包含同一 Issue 的 Metadata；缺失时不以空 Map 继续。 */
export function requireIssueMetadata(issue: { metadata?: unknown } | Record<string, unknown>): Record<string, unknown> {
  const metadata = issue.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new UnknownError("issue get 缺少有效 metadata");
  return metadata as Record<string, unknown>;
}

export interface CommentRecord {
  id?: string;
  content?: string;
  author_id?: string;
  author_type?: string;
  created_at?: string;
}

/** 仅响应不确定时执行回读恢复；权限/参数/业务拒绝不应自动重试。 */
function uncertainWriteResponse(error: unknown): boolean {
  if (!(error instanceof UnknownError)) return false;
  return isTransientNetworkText(error.message) ||
    error.message.includes("输出不是合法 JSON（rc=0") ||
    error.message.includes("输出不是合法 JSON:");
}

export class MulticaClient {
  private cfg: RuntimeConfig;
  constructor(cfg: RuntimeConfig) {
    this.cfg = cfg;
  }

  ws(): string[] {
    return this.cfg.workspace_id ? ["--workspace-id", this.cfg.workspace_id] : [];
  }

  /** 透传 multica 子命令（自动追加 --workspace-id 与 --output json）。 */
  run(args: string[], what: string, opts?: RunJsonOptions): unknown {
    return runJson([...multicaPrefix(this.cfg), ...args], what, undefined, opts);
  }

  getIssue(issueKey: string): IssueRecord {
    const out = runJson(
      [...multicaPrefix(this.cfg), "issue", "get", issueKey, ...this.ws(), "--output", "json"],
      `读取 Issue ${issueKey}`,
      undefined,
      { transient: true },
    ) as IssueRecord;
    if (!out?.id) throw new UnknownError(`读取 Issue ${issueKey} 返回缺少 id`);
    return out;
  }

  /** metadata 全量读取（transient 读；M3.2 回读确认的判定依据）。 */
  listMetadata(issueId: string): Record<string, string> {
    const out = runJson(
      [...multicaPrefix(this.cfg), "issue", "metadata", "list", issueId, ...this.ws(), "--output", "json"],
      `读取 metadata(issue=${issueId})`,
      undefined,
      { transient: true },
    );
    return (out ?? {}) as Record<string, string>;
  }

  /** 评论全量读取（transient 读；--full 返回内容全文，供内容匹配认领）。 */
  listComments(issueRef: string): CommentRecord[] {
    const out = runJson(
      [...multicaPrefix(this.cfg), "issue", "comment", "list", issueRef, "--full", ...this.ws(), "--output", "json"],
      `读取 Issue ${issueRef} 评论列表`,
      undefined,
      { transient: true },
    );
    if (!Array.isArray(out)) throw new UnknownError("评论列表不是有效数组，不能安全认领写入结果");
    return out as CommentRecord[];
  }

  /** 回读确认写（M3.2）：写抛错 → 回读已生效则恢复；未生效重试一次写 → 再回读；仍无 → UNKNOWN。 */
  private confirmedWrite(what: string, write: () => void, isApplied: () => boolean): void {
    try {
      write();
      return;
    } catch (first) {
      if (!uncertainWriteResponse(first)) throw first;
      if (isApplied()) {
        logLine(`[rondo] ${what} 响应丢失但回读确认已生效（断连恢复，不重复写入）`);
        return;
      }
      try { write(); } catch { /* 第二次写失败不直接抛——先回读判定副作用是否已落库 */ }
      if (isApplied()) {
        logLine(`[rondo] ${what} 重试后回读确认已生效`);
        return;
      }
      throw new UnknownError(`${what} 写入未确认 [write-unconfirmed]: ${(first as Error).message}——不猜测写入结果，交人工核对后重跑`);
    }
  }

  /** 仅认领写入前不存在的同内容评论，不能误认历史评论。 */
  private findNewCommentByContent(issueId: string, content: string, before: Set<string>): string | null {
    const hits = this.listComments(issueId).filter((c) =>
      typeof c.content === "string" && c.content === content &&
      typeof c.id === "string" && !before.has(c.id));
    if (hits.length > 1) throw new UnknownError("发现多个新增的同内容评论，无法唯一认领 [write-unconfirmed]");
    return hits.length === 1 ? hits[0].id as string : null;
  }

  private addCommentConfirmed(what: string, write: () => string, content: string, issueId: string): string {
    // 评论创建不具备幂等写语义：先记录基线，响应丢失时只认领新增评论，绝不盲目重发。
    const before = new Set(this.listComments(issueId).map((c) => c.id).filter((id): id is string => typeof id === "string"));
    try {
      return write();
    } catch (first) {
      if (!uncertainWriteResponse(first)) throw first;
      const found = this.findNewCommentByContent(issueId, content, before);
      if (found) {
        logLine(`[rondo] ${what} 响应丢失但回读认领新评论 ${found}（断连恢复，不重复评论）`);
        return found;
      }
      throw new UnknownError(`${what} 写入未确认 [write-unconfirmed]: ${(first as Error).message}——不得自动重发评论，先核对服务端状态`);
    }
  }

  private writeMetadataRaw(issueId: string, key: string, value: string): void {
    runJson(
      [...multicaPrefix(this.cfg), "issue", "metadata", "set", issueId,
       "--key", key, "--value", value, "--type", "string", ...this.ws(), "--output", "json"],
      `写入 metadata(issue=${issueId}, key=${key})`,
    );
  }

  setMetadata(issueId: string, key: string, value: string): void {
    this.confirmedWrite(
      `写入 metadata(issue=${issueId}, key=${key})`,
      () => this.writeMetadataRaw(issueId, key, value),
      () => this.listMetadata(issueId)[key] === value,
    );
  }

  deleteMetadata(issueId: string, key: string): void {
    this.confirmedWrite(
      `删除 metadata(issue=${issueId}, key=${key})`,
      () => {
        runJson(
          [...multicaPrefix(this.cfg), "issue", "metadata", "delete", issueId, "--key", key, ...this.ws(), "--output", "json"],
          `删除 metadata(issue=${issueId}, key=${key})`,
        );
      },
      () => !(key in this.listMetadata(issueId)),
    );
  }

  /** 文件形态评论写入（--content-file；保持既有 CLI 形状）。 */
  addComment(issueId: string, textFile: string): string {
    const content = readFileSync(textFile, "utf8");
    return this.addCommentConfirmed(
      `写入 Issue 评论(issue=${issueId})`,
      () => {
        const out = runJson(
          [...multicaPrefix(this.cfg), "issue", "comment", "add", issueId,
           "--content-file", textFile, "--allow-external-file", ...this.ws(), "--output", "json"],
          `写入 Issue 评论(issue=${issueId})`,
        ) as Record<string, unknown>;
        const id = (out.id ?? (out.comment as Record<string, unknown> | undefined)?.id) as string | undefined;
        if (!id) throw new UnknownError(`评论写入返回无法识别评论 ID: ${JSON.stringify(out).slice(0, 300)}`);
        return id;
      },
      content,
      issueId,
    );
  }

  /** stdin 形态评论写入（--content-stdin；M3.2，供结构化评论调用方免落临时文件）。 */
  addCommentContent(issueId: string, content: string): string {
    return this.addCommentConfirmed(
      `写入 Issue 评论(issue=${issueId})`,
      () => {
        const out = runJsonStdin(
          [...multicaPrefix(this.cfg), "issue", "comment", "add", issueId, "--content-stdin", ...this.ws(), "--output", "json"],
          `写入 Issue 评论(issue=${issueId})`,
          content,
        ) as Record<string, unknown>;
        const id = (out.id ?? (out.comment as Record<string, unknown> | undefined)?.id) as string | undefined;
        if (!id) throw new UnknownError(`评论写入返回无法识别评论 ID: ${JSON.stringify(out).slice(0, 300)}`);
        return id;
      },
      content,
      issueId,
    );
  }

  private writeStatusRaw(issueId: string, status: string, noStart: boolean): void {
    runJson(
      [...multicaPrefix(this.cfg), "issue", "status", issueId, status, ...(noStart ? ["--no-start"] : []), ...this.ws(), "--output", "json"],
      `Issue ${issueId} → ${status}`,
    );
  }

  setStatus(issueId: string, status: string): void {
    // --no-start：状态写入是流转事实，不触发 Run（02：状态与 Run 生命周期分离）
    this.confirmedWrite(
      `Issue ${issueId} → ${status}`,
      () => this.writeStatusRaw(issueId, status, true),
      () => this.getIssue(issueId).status === status,
    );
  }

  /** 显式 --no-start 状态写（route-decision 流转事实；M3.2 委托共享回读确认）。 */
  setStatusNoStart(issueId: string, status: string): void {
    this.confirmedWrite(
      `Issue ${issueId} → ${status}（--no-start）`,
      () => this.writeStatusRaw(issueId, status, true),
      () => this.getIssue(issueId).status === status,
    );
  }

  /** 带启动信号的状态写：失败后不能仅凭 Issue 状态判断 Run 已启动，也不能重发信号。 */
  setStatusWithStart(issueId: string, status: string, what: string): void {
    try {
      this.writeStatusRaw(issueId, status, false);
    } catch (error) {
      if (!uncertainWriteResponse(error)) throw error;
      throw new UnknownError(`${what} 状态写入响应不确定，Run 启动结果无法确认 [run-start-unconfirmed]: ${(error as Error).message}；禁止自动重发，须核对 Run`);
    }
  }

  /** Sub-Issue assignee（--no-start；M3.2 回读确认）。 */
  assignNoStart(issueId: string, agentId: string): void {
    this.confirmedWrite(
      `Sub-Issue ${issueId} assignee（--no-start）`,
      () => {
        runJson(
          [...multicaPrefix(this.cfg), "issue", "assign", issueId, "--to-id", agentId, "--no-start", ...this.ws(), "--output", "json"],
          `Sub-Issue ${issueId} assignee（--no-start）`,
        );
      },
      () => this.getIssue(issueId).assignee_id === agentId,
    );
  }
}
