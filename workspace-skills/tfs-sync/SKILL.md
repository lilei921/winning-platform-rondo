---
name: tfs-sync
description: 按配置将 TFS Work Item 同步至 Multica Issue；适用于定时同步或人工补同步。
---

# tfs-sync

## 执行

使用调用方指定的配置，默认使用本 Skill 的 `config/sync-config.json`。将配置路径解析为绝对路径后执行：

```bash
rondo tfs reconcile-workitem --config "<config-path>"
```

## 结果处理

- 退出码为 `0` 且 `failed` 为空：同步成功。
- 失败时，根据错误原因判断是否重试；临时故障可有限重试。
- `UNKNOWN` 或写入结果不明时，先核对已有写入，确认可安全续跑后重试。
- 重试无进展或需要外部处理时，报告原因及待处理项；不自行修改配置或回滚已确认写入。

汇总最终的 `created / updated / skipped / failed` 数量、Issue 引用、失败原因及未确认或未处理项。

## Issue 的 TFS 来源字段

以下 metadata 由 `rondo tfs reconcile-workitem` 维护，供定位来源 Work Item、核对同步结果时查阅。

| 字段 | 含义 |
| --- | --- |
| `source` | 固定为 `tfs` |
| `tfs.id` | 来源 Work Item ID，字符串形式的同步匹配键 |
| `tfs.type` | TFS Work Item 类型，保留来源值 |
| `tfs.url` | 来源 Work Item 链接 |
| `tfs.changed_at` | 来源 Work Item 的 `changedDate` |
