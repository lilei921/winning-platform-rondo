# pull-request Facts 契约（metadata）

Delivery Issue 上与 PR 物化相关的两个 metadata key（均为 string 类型存储的 JSON）：

## `pr_prep`（Engineer 写入，02 §10.1 最小输入契约的投影）

JSON 数组，每个 required Repository Change 一项：

```json
[
  {
    "repo_key": "dataintegration",
    "source_branch": "feat/256462",
    "target_branch": "main",
    "candidate_commit": "e018cfb75...",
    "title": "PR 标题（语义内容只有 Engineer 可改）",
    "description_ref": "file:D:/.../pr-description.md"
  }
]
```

| 字段 | 必需 | 说明 |
|---|---|---|
| `repo_key` | 是 | 须在 `config/repo-registry.json` 的 registry 中；值等于 repo-context 的 `repo_id`，本地路径另取该条目的 `repo_path` |
| `source_branch` | 是 | 特性分支（§3.5：`feat/<tfs-id>`） |
| `target_branch` | 否 | 缺省取 registry 的 `default_target_branch` |
| `candidate_commit` | 是 | 物化校验锚点：TFS 侧分支 HEAD 必须等于它，不等 → UNKNOWN |
| `title` | 是 | 脚本原样透传，不改写 |
| `description_ref` | 否 | `file:<绝对路径>`；缺省用 title 作描述；其他形式 FAIL |

## `current_pr`（`rondo pr materialize` 写回）

JSON 数组，逐仓登记：

```json
[
  { "repo_key": "dataintegration", "pr_id": 3334, "pr_url": "http://...", "source_branch": "feat/256462", "target_branch": "main" }
]
```

规则：

1. `current_pr` 是 PR Status Sync（缺口⑥）与 finalize（缺口③）的输入事实；
2. 外部已建 PR 而 `current_pr` 缺失时，materialize 复用登记恢复（不重建）；
3. `current_pr` 指向的 PR 在外部查无 active → UNKNOWN，交 Delivery Lead 判断（可能已合并/废弃）。
