---
name: change-handoff
description: 将已获人工批准的 Requirement Change 交给 Engineer；需要核对获批版本、记录批准事实并完成研发交接，或补齐同次交接的未完成操作时使用。
---

# Change Handoff

## 输入与版本核对

使用当前 Issue、已明确的人工批准评论和本 Skill 的 `config/repo-registry.json`。下方 `<config>` 为配置绝对路径，`<workspace>` 取自 `runtime.workspace_id`；Multica 调用沿用配置中的 CLI、Profile / Server 连接环境。

核对当前 `analysis.change_ref`、`analysis.gate.result=PASS` 和真实批准评论。需要核对工程内容与版本时读取：

```bash
rondo analysis read --config "<config>" --issue <issue> --file proposal.md
```

命令返回固定版本的 `source` 和正文；Tasks、Design 等工件按需读取。批准须对应当前 `analysis.source`，并明确是否需要独立验收。批准含糊、版本不一致或读取失败时，说明交接缺口，待澄清后继续。

## 记录批准

将已确认的批准保存为 `analysis.human_approval`（string 类型 JSON），已有相同有效记录时复用：

```json
{
  "decision": "approved",
  "by": "<批准人>",
  "at": "<批准时间，ISO8601>",
  "comment_ref": "<当前 Issue 的批准评论 ID>",
  "verify_agent_required": false,
  "source": {
    "repo_url": "<仓库 URL>",
    "branch": "<来源分支>",
    "commit": "<完整 SHA>",
    "change_ref": "<Change ID>"
  }
}
```

`source` 使用实际获批版本的来源；`false` 仅为示例，取值来自人工对独立验收建议的明确接受或调整。

```bash
multica issue metadata set <issue> --key analysis.human_approval \
  --value '<approval-json>' --type string --workspace-id <workspace> --output json
multica issue metadata list <issue> --workspace-id <workspace> --output json
```

将实际 JSON 作为一个参数传入；回读一致后继续。写入结果未知时先核实已有记录，不重复覆盖。

## 交接 Engineer

先核对同一 Change 版本的交接评论和 Run，复用仍有效的交接。首次获批且 Issue 为 `analysis_review` 时，推进到 `in_progress` 并回读；已处于 `todo` / `in_progress` 时沿用当前状态：

```bash
multica issue status <issue> in_progress --no-start --workspace-id <workspace> --output json
multica issue get <issue> --workspace-id <workspace> --output json
```

其他状态或状态写入结果未确认时，说明原因，不启动研发。

交接前确认当前来源与批准记录仍匹配。在当前 Issue 使用原生有效 `@Engineer` Mention 交接完整 Change，提供 `change_ref`、批准引用和必要附加条件；工程范围引用获批 Proposal。交接中断时先回读，只补尚未完成的动作，避免重复唤醒。

返回交接结果和评论引用；未完成时指出停在哪一步及缺少的信息。交接成功表示已委派，不代表研发完成。
