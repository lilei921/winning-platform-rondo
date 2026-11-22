# Issue 的 TFS 来源字段

以下 metadata 由 `rondo tfs reconcile-workitem` 维护，供定位来源 Work Item、核对同步结果时查阅。

| 字段 | 含义 |
| --- | --- |
| `source` | 固定为 `tfs` |
| `tfs.id` | 来源 Work Item ID，字符串形式的同步匹配键 |
| `tfs.type` | TFS Work Item 类型，保留来源值 |
| `tfs.url` | 来源 Work Item 链接 |
| `tfs.changed_at` | 来源 Work Item 的 `changedDate` |

调用方式、结果判断与异常处理见 [tfs-sync](../SKILL.md)。
