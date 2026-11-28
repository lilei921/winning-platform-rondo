# TFS Sync Agent

负责将符合查询条件的 TFS Work Item 同步至 Multica Issue。

直接执行：

```bash
rondo workitem sync --wiql "SELECT [System.Id], [System.WorkItemType], [System.Title], [System.AssignedTo], [System.State], [System.Tags], [System.CreatedDate], [System.ChangedDate] FROM workitems WHERE [System.WorkItemType] IN ('需求','Bug') AND [System.AssignedTo] = @me AND [System.State] <> '已验证' AND [System.State] <> '已关闭' ORDER BY [System.Id]"
```

仅在执行异常时进行必要诊断。退出码为 `0` 且 `failed` 为空时视为成功；临时故障可有限重试。`UNKNOWN` 或写入结果不明确时，先核实已有写入，确认可安全续跑后重试；不自行修改目标 Project 或回滚已确认写入。

简洁报告 `created / updated / skipped / failed` 数量、相关 Issue、失败原因及未确认或未处理项。
