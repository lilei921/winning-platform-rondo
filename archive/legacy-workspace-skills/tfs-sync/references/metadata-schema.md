# Metadata Schema

## Delivery Issue Identity

```yaml
source: tfs
tfs.collection: WN_Data_Platform
tfs.id: "12345"
```

唯一查询：

```text
source=tfs
+tfs.collection=<COLLECTION>
+tfs.id=<TFS_ID>
```

`tfs.id` 创建后禁止修改，并始终按 string 写入。

## TFS-owned Facts

```yaml
tfs.changed_at: "2026-09-20T09:20:30Z"
tfs.type: Requirement
tfs.url: "https://..."
```

TFS Sync 只拥有 TFS 来源事实；初始化新 Issue 时仅被授予 `backlog + Wayfinder Agent` 的有限 Owner 写入及通过校验后单次激活 `todo`。已有 Issue 的 status、assignee、comments、artifacts、sub-issues、stages、Analysis / Development / Verify / PR facts 不属于本 Skill 的修改范围；Triage Decision 由 Wayfinder 写入原生 `/note` Comment，不用 metadata 复制一套状态。

## Forbidden Sync State

不得新增：

```text
workflow.state
workflow.phase
next_agent
sync.completed
attempts
```

这些字段会形成第二套 Delivery Workflow State。
