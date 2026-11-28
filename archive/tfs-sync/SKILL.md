---
name: tfs-sync
description: 将符合查询条件的 TFS Work Item 同步至 Multica Issue；适用于定时同步或人工补同步。
---

# tfs-sync

## 执行

执行以下命令：

```bash
rondo workitem sync --wiql "SELECT [System.Id], [System.WorkItemType], [System.Title], [System.AssignedTo], [System.State], [System.Tags], [System.CreatedDate], [System.ChangedDate] FROM workitems WHERE [System.WorkItemType] IN ('需求','Bug') AND [System.AssignedTo] = @me AND [System.State] <> '已验证' AND [System.State] <> '已关闭' ORDER BY [System.Id]"
```

## 结果处理

- 退出码为 `0` 且 `failed` 为空：同步成功。
- 失败时，根据错误原因判断是否重试；临时故障可有限重试。
- `UNKNOWN` 或写入结果不明时，先核对已有写入，确认可安全续跑后重试。
- 重试无进展或需要外部处理时，报告原因及待处理项；不自行修改目标 Project 或回滚已确认写入。

汇总最终的 `created / updated / skipped / failed` 数量、Issue 引用、失败原因及未确认或未处理项。
