# Development Evidence 契约（development-execution）

> Owner：本文件是 `evidence.json` 字段契约的唯一权威定义（One Rule, One Owner）。
> `rondo dev check-completion` 消费本契约的机器可判定子集；Engineer 在 Run 内产出符合本契约的 Evidence。

## evidence.json 结构

```json
{
  "change_ref": "tfs-999002-fill-project-context",
  "task_refs": ["1.1", "1.2", "1.3"],
  "local_validation": {
    "result": "PASS",
    "summary": "yaml.safe_load 解析通过；openspec validate --all exit 0",
    "evidence_refs": ["openspec/changes/<change>/validation/…"]
  },
  "code_review": {
    "result": "PASS",
    "findings": [
      { "id": "F-1", "axis": "engineering-standards", "severity": "minor",
        "area": "src/foo.ts:42", "evidence_ref": "…", "suggestion": "…",
        "summary": "…", "resolved": true, "resolution": "…" }
    ]
  },
  "commits": [
    { "repo_path": "<root_repo 绝对路径，运行时解析值>", "branch": "master", "sha": "4aaf0e9…" }
  ],
  "contract_files": {
    "algorithm": "sha256",
    "files": {
      "proposal.md": "e3b0c442…",
      "tasks.md": "2c26b46b…",
      "specs/<capability>/spec.md": "fcde2b2e…"
    }
  },
  "pr_preparation": {
    "required": false,
    "reason_if_not_required": "OpenSpec 根仓产物不建独立 PR（02 §963-964）"
  },
  "blockers": []
}
```

## 字段规则

| 字段 | 规则 |
|---|---|
| `change_ref` | 必须与派发的 change_ref 一致（脚本核对） |
| `task_refs` | 必须覆盖本次 assigned task_refs 全集（脚本核对覆盖） |
| `local_validation.result` | `PASS` / `FAIL`；FAIL 时整体 Completion 不得报 PASS |
| `local_validation.summary` | 必填；具体命令与退出码写进 summary 或 evidence_refs 指向的文件 |
| 逐 Task 验证 | 复用 `local_validation.summary` / `evidence_refs` 与已有测试记录、Candidate 引用，提供每个 assigned Task 的实际验证依据；本轮不强制增加 `verification[]` Schema |
| `code_review.result` | `PASS` / `FAIL` |
| `code_review.findings[]` | 未解决的 Blocking Finding（`blocking` 缺省按阻断性处理）必须 FAIL；显式 `blocking: false` 的未解决 Finding 仅在提供非空 `risk_note` 或 `risk_ref` 时可保留。原有 Finding 定位/证据/建议信息供人工复核；CLI 不判语义正确性 |
| `commits[]` | 至少一条；`sha` 须为 7–40 位十六进制；`branch` 必填 |
| `commits[].repo_path` | 提供时脚本可用 `--verify-commits` 在仓内核验 sha 存在性；启用 `commit_task_links` 检查（`--issue` + `--registry-config`）时**必填**——脚本需在仓内 `git log --format=%B` 读取 Commit Message 核验 `Refs:` 尾注行（需求/Bug 同一规则：含 `#<tfs.id>` 父工作项号且不引用其他工作项 id；legacy 在途交付沿用 `#<任务ID>` 口径）。同时是 PR 通过后 tfs-writeback commit↔任务关联的 repo_key 反解依据（须为枢纽路径 `root_repo/<repo_path>` 的绝对路径） |
| `commits[]` 与任务关联 | Commit ↔ TFS 工作项的关联事实**不复制**进 evidence（Reference-not-Replication）：规范位置是 Commit Message 的 `Refs:` 尾注行，核验脚本现场从 git 提取。业务仓（`root_repo/<已登记 repo_path>`）的 commit 必须有 `Refs:` 行；仅 `root_repo` 本身的 commit 豁免，根仓下其他目录不豁免。**2026-10-30 TFS 剥离后（tfs-writeback-decoupling-plan）需求/Bug 同一规则：`Refs:` 只写 `#<tfs.id>`，不核验 task_ref 覆盖**；commit 与子任务的精细关联由 PR 通过后的 tfs-writeback 按本 `commits[]`（repo_path × sha）以 Artifact Link 挂到新建子任务上——`commits[]` 因此新增下游消费者，字段契约不变。legacy 过渡：active dispatch 条目存在 `tfs_task_ids` 的在途交付沿用旧口径（`#<任务ID>` 且覆盖 task_refs），由 check-completion 判定 |
| `pr_preparation.required` | 显式 `true` / `false`，不允许省略 |
| `contract_files` | 契约文件哈希绑定（2026-11-08，rll5-replay-remediation M2.2）：`algorithm` 固定 `sha256`；`files` 键为 Change 目录内相对路径（posix 分隔），覆盖 `proposal.md`、`tasks.md`、`design.md`（有则）、`specs/**/*.md`（递归）。取值命令：`rondo dev contract-hash --openspec-root <根仓> --change-ref <change_ref>`（输出即本字段内容，归档目录同样可解析）。归一化规则：哈希前 CRLF/CR→LF，且 `tasks.md` 的 `- [x]/[X]` 勾选归一为 `- [ ]`——**勾选进度变化不改哈希**，不需要为勾进度重算；但契约正文变化后必须针对当前契约重新验证并生成新 Evidence，不能仅给历史 Evidence 重算哈希。Engineer Completion Check 先核对 `contract_files`（缺失 → UNKNOWN，哈希不匹配 → FAIL）；Delivery Completion Gate 再按当前候选仓库/Commit 与 active Task Set 选择有效 Evidence 并复核契约；被当前有效 Evidence 完整替代的历史记录保留但不再阻断（不自动补勾） |
| `pr_preparation`（required=true） | `title` / `description_ref` 两者必填（`work_item_ref` 必填要求已于 2026-11-03 移除：其值恒等于 Issue metadata `tfs.id`，PR 关联走 metadata 链路，evidence 重复声明无消费方——WNDF-52 D3） |
| `pr_preparation`（required=false） | `reason_if_not_required` 必填（如根仓产物无独立 PR） |
| `blockers[]` | 非空即 FAIL；有 blocker 时应停止并回流，而不是提交带 blocker 的完成声明 |

## 与 Issue 的关系

- evidence.json 是**工程侧结构化事实**；Issue 评论中回流其摘要与指针（路径），不全文双写（Reference-not-Replication）；
- 证据文件的存放位置跟随当前 Change（`openspec/changes/<change>/` 下）或代码仓验证目录，Issue 上只放引用。

## 落位约定（tfs-writeback commit 关联的硬性前提）

- **须落位 Change 目录顶层**：文件名匹配 `evidence*.json`、位于 `openspec/changes/<change_ref>/`（含归档后 `changes/archive/*<change_ref>`）顶层的 evidence 才参与 PR 通过后 tfs-writeback 的 commit↔任务关联（writeback 只扫描该位置，合并各文件 `commits[]`）；
- 散落在代码仓验证目录、未进 Change 目录的 evidence **不参与关联**（writeback 输出 `evidence_missed` 提示，不阻断）；多 Run 产出多个 evidence 文件时分别以 `evidence*.json` 命名落位同一 Change 目录即可。

## Finalize 的当前证据覆盖

- 必须有当前 Change 的 active dispatch 和覆盖其全部 task_refs 的有效 Evidence；空集合不能得到 PASS。
- 有 `pr_prep` 时逐仓核对 `repo_key` 对应路径与 `candidate_commit`，相同 SHA 出现在其他仓不算匹配；每个候选都必须有当前有效证据。
- 所选 Evidence 的 `contract_files` 必须对应当前 Change 契约；有效当前记录覆盖后，旧哈希、旧候选的历史记录原样保留。只有历史记录而没有当前覆盖时仍阻断。
- 没有 `pr_prep` 的 legacy 交付仍须满足 active Task Set 和当前契约哈希，不通过空候选绕过检查。
