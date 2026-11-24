# 10 — TFS 子任务拆分、工时估计与 Commit 独占关联设计

> Status: Implementation Review（PR #137；待真实 TFS 验收）  
> Date: 2026-11-19  
> Scope: Requirement 交付收口中的 TFS 子任务创建、工时估计及 Commit→TFS Task 独占关联；不改变工程研发流程及 Bug Fix 流程

## 1. 目标与原则

在 Requirement PR 完成后，由 Squad 外的 **PR Status Sync Agent** 依据 OpenSpec `tasks.md` 和实际交付情况决定 TFS 子任务拆分与估计工时，交由 `issue-closeout` 编排，**Rondo** 负责确定性校验、创建/复用、Commit 关联、工时与状态回写。

- **类型依据**：仅 `tfs.type=需求` 创建 TFS 子任务；`Bug` 不创建；未知类型停止。
- **任务依据**：以已批准的 OpenSpec `tasks.md` 为主要依据，必要时参考真实 Evidence / PR 交付事实。
- **数量范围**：每个需求创建 **1–5 个** TFS 子任务；不与 `tasks.md` checkbox 一一对应。
- **估计范围**：每个 TFS 子任务 `OriginalEstimate` 为 **0.5–4h**，由 Agent 根据执行情况和复杂度判断。
- **Commit KPI Hard Constraint**：**一个真实业务 Commit 最多关联一个 TFS Task；每个 TFS Task 至少关联一个不同的真实业务 Commit。** 一个 TFS Task 可以关联多个 Commit；由 Rondo CLI 验证、关联并回读，任何违规或结果不可信均阻断收口。
- **独立边界**：不要求 Workitem Analyst、Engineer、Bug Fix Agent 或 Delivery Lead 管理 TFS 子任务、估时或为 TFS 调整工程任务粒度。
- **最小修改**：复用现有 PR Status Sync Agent、`issue-closeout`、Rondo `tfs writeback`、TFS API 和原有 Finalize Gate；不新增 Agent、Skill、Dispatch、外部数据库或状态机。

上位原则与关联设计：
- [01 — Unified Design Guideline](01-multica-openspec-design-guideline.md)：Specialist Focus、KISS、One Rule One Owner、Native First、Deterministic First / Semantic Fallback、Reference-not-Replication。
- [08-B — Requirement Remote Git Delivery](08b-requirement-remote-git-delivery.md)：跨 Runtime 工件和交付收口。
- [09 — Unified Engineer Development](09-unified-engineer-development-design.md)：`tasks.md` 是工程任务，不是 TFS Task Set。

## 2. 现状与待补齐能力

截至 2026-11-19 的 `main` 实现：

| 当前组件 | 已具备 | 本次差距 |
| --- | --- | --- |
| `agents/pr-status-sync-agent` | PR 状态核实、按 `finalize` / `resume_finalize` 触发 `issue-closeout` | 未承担任务分组和估计决策 |
| `workspace-skills/issue-closeout/SKILL.md` | `Prepare → Writeback → Complete` 三阶段 | 缺少 Requirement 条件性任务规划 |
| `tools/rondo/src/commands/tfs/requirement-tasks.ts` | 默认创建 `[Issue Delivery]` 单任务；识别已有 `[Issue Delivery/1..5]`；按父项和标题认领 | 不接收 Agent 计划，不核对规划任务与估计 |
| `tools/rondo/src/commands/tfs/writeback.ts` | 统一任务物化、Commit 关联、任务解决、父项回写及后置验证 | 新 Requirement 仅关联父需求、失败不阻断；没有子任务 Commit 独占核验 |
| `tools/rondo/src/tfs/api/workitem.ts` | `workitem create --estimate`、`set-state --complete-with-estimate`、`workitem link-commits` | 已有 ArtifactLink 写入能力；新门禁需核对准确仓库身份及 SHA |
| `tools/rondo/src/tfs/api/query.ts` | 以 `$expand=all` 读取 Work Item，但只投影字段/附件 | 尚未暴露 Commit `ArtifactLink`，不能直接用当前输出验证新门禁 |
| `rondo analysis read` | 读取 `analysis.source` 批准 Commit 的 `tasks.md` | 不等于最终 checkbox 进度；不得误称最新版本 |

现有 08-B/09 对 TFS 管理的“默认一个，必要时由 Delivery 拆合”需要修订：**新 Requirement 正常路径必须先形成 Agent 任务计划，再创建子任务**，而不是继续无条件生成泛化单任务。当前新路线只将 Evidence Commit 关联到 TFS 父需求，`commit_link_failed` 是非阻断项，**尚未要求子任务关联 Commit**；本方案将子任务 Commit 关联提升为 Rondo Hard Gate。旧的 `dev.dispatch` 路线与 Bug 路线保持可用。

## 3. 职责与触发

| Owner | 职责 | 不承担 |
| --- | --- | --- |
| **PR Status Sync Agent** | 在 PR 全部 completed 且 Prepare PASS 后，基于 `tasks.md`、执行证据和可用 Commit 决定任务分组、总结性描述、工时及 Commit 独占分配，报告异常 | 不直接修改 TFS；不修改研发成果或制造 Commit |
| **`pr-status-sync` Skill** | 核实和对账已登记 PR 外部状态，产生 `finalize` / `resume_finalize` | 不拆任务、不估时 |
| **`issue-closeout` Skill** | 指导 Prepare、条件性规划、Writeback、Complete 的顺序与停止条件 | 不替代 Agent 的语义判断；不自行实现 TFS HTTP 写入 |
| **Rondo** | 校验身份、计划、可用业务 Commit 和全局 Task 独占归属；创建/认领任务；按计划关联并回读子任务 Commit；回写 TFS | 不机械按 checkbox 拆分，不伪造或重复分配 Commit，不决定无依据的业务映射 |
| **TFS** | 子任务、工时字段和 Commit `ArtifactLink` 的权威数据 | 不充当 OpenSpec 工程事实源 |

正常触发：`rondo pr reconcile-status` 输出明确 `finalize` 或 `resume_finalize`；PR Status Sync Agent 在同一 Run 内使用 `issue-closeout`。没有符合条件的 PR 终态时，不触发 TFS 子任务创建。

## 4. 目标执行流程

```text
PR Status Sync Agent
  └─ pr-status-sync → action=finalize / resume_finalize
       └─ issue-closeout
            1. rondo delivery finalize --phase prepare
               ├─ PASS, status=prepared → 继续
               └─ already=done → 结束（不得重写）
            2. 判断 tfs.type
               ├─ Bug → 跳过任务规划
               ├─ 需求 → 读取 tasks.md，规划或复用已保存计划
               └─ 缺失/不支持 → 停止
            3. rondo tfs writeback
               ├─ 需求：可用 Commit 与独占核验 → 计划校验/复用 → 子任务创建
               │        → 按计划单归属关联 Commit/回读 → 子任务解决/工时回写 → 父需求回写
               └─ Bug：原有父 Bug 回写
            4. rondo delivery finalize --phase complete
               └─ TFS 实际状态核对 PASS → Issue done
```

**不可交换的顺序**：只有 `Prepare PASS` 后才能写 TFS；先确认真实业务 Commit 与无重复归属的计划，再创建子任务。每个任务至少一个独占 Commit，且全局无其他 Task 占用，经回读 PASS 才能解决任务、回写父项及 Complete。失败/未知不得作为 PASS，不重放已确认的副作用。

## 5. 任务拆分与工时估计

### 5.1 信息来源

- 主要来源：批准版 `tasks.md`，使用现有 `rondo analysis read --config "<config>" --issue <KEY> --file tasks.md`。
- 补充来源：必要的真实执行 Evidence、PR 交付信息及 Prepare 确认事实。
- `analysis read` 锚定批准版本，**不是**最新执行进度；当前交付完成由 Prepare 的工程校验确认。不要为任务规划另造第二套工程 Task。
- 如果当前 Requirement Change 按工程契约应有 `tasks.md` 而缺失或无法读取，则停止，不能回退到无依据的“默认 1 个 / 默认 1h”。
- Bug 无需 OpenSpec `tasks.md`，沿用原 Writeback。
- 工程任务只用于规划依据：允许几个 OpenSpec Tasks 合成一个 TFS Task，或一类工作覆盖多个 Source Refs；不得为满足 TFS 数量更改 `tasks.md`。

### 5.2 拆分方法

Agent 根据可辨认的交付内容和复杂度合理归并工作：例如接口及权限、前端交互、集成验证。一个相关工作包对应一个管理任务，不要求按技术组件或文件数固定拆分。

- **Hard Constraint**：TFS 子任务数 `1 <= N <= min(5, 可用且未被其他 Task 占用的唯一真实业务 Commit 数)`；一个任务可以分配多个不同 Commit。
- **Hard Constraint**：每任务须有非空可区分的总结、有效工时、`tasks.md` 来源引用和至少一个独占 Commit；完整 TFS 标题由 Rondo 拼接父需求标题。
- **Recommended Method**：优先归并紧密相关的实现和验证任务，不为凑满 5 个而拆分，也不为减少数量强行合并不相关工作。
- **Outcome Contract**：形成能解释本次交付的、与实际工作相符的 TFS 管理任务；不建立新的 Engineer Assignment 或 `task_refs` 派发事实。

例如 8 条 `tasks.md` checkbox 可归并为 3 个 TFS 子任务：

| Task 总结性描述 | OpenSpec Source Refs | 估计 |
| --- | --- | ---: |
| 接口与权限实现 | `1.1`、`1.2`、`1.3` | 2.5h |
| 前端交互 | `2.1`、`2.2`、`2.3` | 2h |
| 集成验证 | `3.1`、`3.2` | 1h |

该表仅为结构示例；只有在存在至少 3 个真实、未被其他 TFS Task 占用的业务 Commit 时，才允许创建 3 个子任务。不代表实际工时或 Commit 分配事实。

### 5.3 工时口径

| 字段 | 创建时 | 解决时 |
| --- | --- | --- |
| `OriginalEstimate` | Agent 的 `estimate_hours` | 保持原值 |
| `RemainingWork` | 等于 `OriginalEstimate` | `0` |
| `CompletedWork` | 不写 | 按**当前 Rondo 既有约定**回填 `OriginalEstimate` |

- 每个任务 `0.5 <= estimate_hours <= 4`，单位小时。
- 根据实际工作范围、实现难度、修改复杂度和验证成本判断；可参考 `0.5–1h`（简单）、`1–2h`（一般）、`2–3h`（较复杂）、`3–4h`（较重），**不使用固定评分公式**。
- 建议按 0.5h 粒度表达，但不强制 CLI 只接受 0.5 的整数倍。
- 五个任务最多承载 20h 的估计总额。**不得为满足上限而伪造低工时**；客观估计无法表达时停止并报告约束冲突。
- **概念说明**：这里 `CompletedWork = OriginalEstimate` 是现有系统的“按估计自动填完成工时”约定，不是测量出的真实投入工时；本期不设计实际工时采集。
- 如果整个 Change 只有 1 个真实可用 Commit，则只能创建 1 个 TFS Task。若该任务无法用 0.5–4h 合理表达真实复杂度，必须报告 KPI 与工时上限冲突，不得拆出重复绑定同一 Commit 的任务或低报工时。

## 6. Agent 与 Rondo 的输入契约

### 6.1 最小任务计划

Agent 提供单个 JSON 文件；Rondo 读取 Issue 的 `tfs.id`、`tfs.type`、`analysis.change_ref` 等事实。Agent 从 Rondo 核验的 PR Commit 中选取与实际业务任务相关的提交，**每个被选中的 Commit 只归属一个 TFS Task**；Rondo 对这种归属施加确定性硬校验。

```json
{
  "tasks": [
    {
      "summary": "实现接口与权限控制",
      "estimate_hours": 2.5,
      "source_refs": ["1.1", "1.2"],
      "commits": [{ "repo_key": "backend", "sha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
    },
    {
      "summary": "完成前端交互与验证",
      "estimate_hours": 1.5,
      "source_refs": ["2.1", "2.2"],
      "commits": [{ "repo_key": "frontend", "sha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" }]
    }
  ]
}
```

以上 Commit SHA 仅为 JSON 结构示例，实际运行必须使用 Rondo 回读核验的真实提交。

| 字段 | 要求 |
| --- | --- |
| `tasks` | 非空，长度 1–5，且不超过可用唯一业务 Commit 数量 |
| `summary` | 非空、可区分的 Task 总结性描述；不包含原需求标题或机器身份标记 |
| `estimate_hours` | 有限数值，0.5–4，不能缺省 |
| `source_refs` | 非空数组，元素能在本次批准 `tasks.md` 中定位 |
| `commits` | 非空数组；每项 `{repo_key, sha}`，必须匹配本次 Change 的真实可用业务 Commit；所有 Task 之间不可重复 |

`source_refs` 是引用，不产生 `dev.dispatch`、新任务状态或 OpenSpec 任务副本。Agent 负责合理归并工程工作、将 Commit 分配给唯一管理任务；Rondo 校验引用、Commit 身份、任务间唯一性和 TFS 已有关联，不替 Agent 推测代码语义。Rondo 读取父需求 `System.Title`，按 `<原 TFS 需求标题> - <Task summary>` 生成子任务标题，Agent 无需重复维护需求标题。

### 6.2 CLI（实施入口）

```bash
rondo delivery finalize --phase prepare --issue <KEY> --root-repo "<root_repo>"

# 只读返回当前 Change 经核验的 PR Commit
rondo tfs writeback --issue <KEY> --inspect --root-repo "<root_repo>"

# Agent 提供 Commit 单归属任务计划；恢复可复用已登记计划
rondo tfs writeback --issue <KEY> --task-plan "<task-plan.json>" --root-repo "<root_repo>"

rondo delivery finalize --phase complete --issue <KEY> --root-repo "<root_repo>"
```

- 扩展既有 `rondo tfs writeback`，不新增独立的估算/分配 CLI。新增同命令只读 `--inspect` 返回已核验的业务 Commit（`repo_key + sha`）及可用性；Agent 生成每个 Task 的 `commits` 分配，Rondo 严格核验，不把同一个 Commit 复制给多个 Task。
- 新 Requirement 第一次写入必须有有效任务计划；**禁止**在缺少计划时回退到当前 `ensureDeliveryTasks()` 的默认单任务逻辑。
- 已确认计划的恢复执行可以不传 `--task-plan`；传入不同计划时拒绝自动覆盖。
- Bug 继续使用原命令、不传任务计划、不创建子任务。
- 旧 `dev.dispatch` Requirement 恢复路径及既有 CLI 行为保留；新 `--task-plan` 不隐式改变旧路线。

### 6.3 Commit 独占归属 Hard Gate（公司 KPI）

**规则**：一个真实业务 Commit **只能绑定一个 TFS Task**；每个规划 TFS Task **至少绑定一个**不同的 Commit。允许多个 Commit 归并至一个 Task，禁止同一 Commit 被复制给多个 Task。该规则不是 Agent 的建议方法，而是 Rondo CLI 的硬性拒绝条件。

1. **可用 Commit 来源**：Rondo 以已通过 Prepare 的 `pr_prep`、归档 Change 的 `evidence*.json` 和已完成 PR 的真实源分支 Commit 为依据，取得实际业务仓的 `repo_key + repo_url + 完整 SHA`。至少包含经核实的 Candidate Commit；其他 Commit 必须经同仓、同 Change、PR 提交范围验证后才能使用。排除 OpenSpec 根仓 Archive Commit、来源不明的 SHA、非本 Change 的历史提交和人工虚构 Commit。跨 Runtime 无需 checkout。
2. **规划方式**：Rondo `--inspect`（只读）输出已核实的 PR 变更 Commit（含修改路径与摘要）；PR Status Sync Agent 依据 `tasks.md`、Evidence 和实际改动选出与业务任务相关的 Commit，**每个被选中的 Commit 仅分配给一个任务**，在任务计划 `commits[]` 中写明；无关提交不强制计入 KPI。Rondo 校验每项非空、身份有效、在本计划中仅出现一次、分配的 Commit 属于本 Change。若只有一个可用 Commit，规划只能有一个 TFS Task，不为提高任务数量制造 Git Commit。一个 TFS Task 可以包含多个来源 `source_refs` 和多个 Commit。
3. **全局独占检查**：Rondo 必须回读当前 Commit 在 **TFS Collection 中已关联的 Work Items**，识别其中类型为 `任务` 的 Work Item；若已绑定别的 Task 则拒绝关联，已绑定当前 Task 则作为幂等成功。仅检查当前 Issue 子任务的计划不够。使用完整项目/仓库 GUID 与 SHA 识别 Commit，不能只按 SHA 模糊匹配。
4. **TFS 2018 可用性**：微软 Git Commits 查询接口有 `searchCriteria.includeWorkItems` 参数，可作为验证反向关联的候选途径；在现有 **TFS 2018 Update 3.2** 环境必须做真实集成测试，验证 `fromCommitId=toCommitId` 查询是否完整返回关联 Work Items、跨 Project Task、已删除/不存在项的处理以及权限可见性。不得把未验证的 API 行为当作全局独占保证；无法可靠查询时返回 UNKNOWN 并停止，不降级为只查当前 Issue。
5. **写入与恢复**：Rondo 使用现有 `workitem link-commits` 对计划指定的 Task 各自关联其独占 Commit，**绝不把完整集合广播给每个 Task**。写前检查占用，写后对当前 Task 的 `ArtifactLink` 和 Commit 的反向关联再次回读确认。部分失败只补缺失关系，不迁移或删除其他 Task 的关联，直到全部独占验证 PASS 才允许置态、父需求回写和 `delivery.tfs_written=true`。
6. **并发边界**：仅有先查后写不构成并发情况下的全局唯一约束。同一 Commit 的跨 Issue Writeback 需要沿用可用的串行写机制；若没有能防止两个并发 Writer 同时认领的机制，则不得声称具备严格的全局唯一保证，实施必须阻断并发冲突。不要为普通规划引入独立 Task 管理系统。
7. **父项关联**：**新 Requirement 不再自动把同一批业务 Commit 链接到父需求**。父需求现有 PR/业务状态关联可保留，但不能代替子任务关联，也不能当作 KPI Task 归属；旧路线不在此次改造范围内。

## 7. 幂等、冲突与失败恢复

### 7.1 唯一额外持久化事实

建议在现有 Multica Issue Metadata 中存储 `delivery.tfs_task_plan`，只用于新 Requirement TFS Writeback：

- Rondo 校验计划和当前 Issue、Parent、已批准 `tasks.md`、真实业务 Commit 来源及**唯一 Task 归属**，**在首次 TFS 子任务创建前**写入并回读此字段。
- 重试优先复用已确认计划；本字段不成为另一套工程任务真相，也不产生额外 Lifecycle。
- 任务和工时的最终权威仍是 TFS 已落账工作项；仅凭 Metadata 不算创建成功。
- 同 Issue 的 Writeback 应串行；现有环境若无法保证同 Issue 不会并发创建，应在实施时使用已有运行/锁定能力保障，避免“先查再创建”竞态。不要因这一点另建泛化锁服务。

### 7.2 TFS 身份、命名与恢复

**新规划任务的 TFS 标题使用原父需求名称，拼接 Task 总结性描述**，不再使用 `[ISSUE Delivery/N]` 作为展示标题：

```text
TFS 父需求标题：住院病案质量指标优化
Task summary：实现接口与权限控制
TFS 子任务标题：住院病案质量指标优化 - 实现接口与权限控制
```

- Rondo 读取 TFS 父需求的 `System.Title`，按 `<原 TFS 需求标题> - <Task summary>` 拼接；Agent 不需要复制需求名称。
- `summary` 由 Agent 根据 `tasks.md` 总结。各项须可区分、简洁明确；Rondo 校验生成标题不重复且满足 TFS 标题长度限制。不满足时在创建前停止，不擅自截断父需求名称。
- **展示标题与幂等身份分离**：稳定身份为 **TFS Parent ID + Multica Issue Key + 计划序号 N（1–5）**。序号不写入标题，而由 Rondo 在子任务 `System.Description` 中写入稳定标识（如 `Multica Delivery Task: <ISSUE>/N` 与 OpenSpec Change 引用），以支持断点恢复。
- 恢复时按 TFS 父需求的实际子项关系读取任务，再核对 Description 中的身份标识及父链；**不得只按标题前缀或相同标题认领**。复用已持久化的 `delivery.tfs_task_plan` 和计划顺序，仅补缺失任务。
- 父需求或子任务在创建后被人工重命名时，不自动修改已有子任务标题；依稳定标识继续核对身份与工时。

| 场景 | 预期行为 |
| --- | --- |
| 首次无计划、无本 Issue 已规划子任务 | 校验计划、回读 TFS 父需求标题并持久化计划 → 拼接标题、依次创建并回读 |
| 有已确认计划，尚未全部创建 | 按父链和 Description 中的 `<ISSUE>/N` 标识认领，仅补缺失序号 |
| 重复提交一致计划 | 复用，不重复创建 |
| 已保存计划与新计划不一致 | 停止，不自动覆盖 |
| 已有旧 `[Issue Delivery]` 或 `[Issue Delivery/N]` 子任务 | 停止并报告人工核对；不在旧任务旁盲目创建新格式任务 |
| 相同身份标识存在多个任务、父项不匹配 | 停止，保留现场 |
| TFS 创建响应丢失 | 通过父子链接及 Description 标识回读认领；不得盲目重发 POST |
| 子任务 Commit 链接部分成功/失败或回读不明 | 停止后续任务解决及父需求回写；重跑先回读现有链接，仅补缺失关系，不重复写入 |
| 某个 Commit 已被其他 TFS Task 关联 | 新关联 FAIL，不迁移或删除外部 Task 的关联，报告冲突 |
| 可用唯一 Commit 数少于计划的 TFS Task 数 | 创建前 FAIL；应归并 Task 或报告工时上限冲突 |
| 同名标题已存在但没有身份标识 | 不仅凭同名自动认领，报告冲突，避免误采用人工创建的任务 |
| 已有任务的 `OriginalEstimate` 与计划冲突 | 停止，不覆盖可能由 Human 修改的工时 |
| 已全部确认写回 | 只读核对，不重新估算、创建或更新 |
| `Bug` | 跳过计划和子任务创建 |

新规划任务必须核实 `OriginalEstimate` 存在且与计划一致；旧路线既有 `estimate_missing` 兼容行为不应因本次变更意外退化。

### 7.3 必须验证的外部写入事实

新 Requirement 完成 Writeback 后，Rondo 回读确认：

1. 子任务数量与已保存计划一致，身份标识及父链匹配；新创建的标题符合父需求名称与 Task summary 拼接规则。
2. **每个子任务至少有一个按本次计划唯一分配的业务 Commit `ArtifactLink`**；按完整仓库身份和 SHA 回读确认，全部子任务间无重复 Commit，且该 Commit 不被其他 TFS Task 占用。父需求上的链接不能替代子任务。
3. 每个子任务已解决，`OriginalEstimate=计划估计`、`RemainingWork=0`、`CompletedWork=OriginalEstimate`。
4. TFS 父需求已解决，收口评论按现有稳定引用去重。
5. 仅全部确认后写 `delivery.tfs_written=true`；`delivery finalize --phase complete` 再次执行只读核对后设置 Issue `done`。

`FAIL` 表示已知前置/契约冲突；`UNKNOWN` 表示外部写入或回读无法确认、可能部分成功。二者都不允许推进 Complete。恢复先回读真实 TFS，再补未完成步骤，不回滚已确认副作用。

## 8. 代码与文档实施范围

| 资产 | 变更要求 |
| --- | --- |
| `projects/multica/agents/pr-status-sync-agent/instructions.md` | 在职责中补充 Requirement 交付后子任务拆分/估时；不复制整套过程 |
| `projects/multica/agents/pr-status-sync-agent/autopilot-prompt.md` | 保留 PR Sync → issue-closeout 路由；只在确有必要时最小更新 |
| `projects/multica/workspace-skills/issue-closeout/SKILL.md` | 在 Prepare 和 Writeback 之间增加条件性规划及恢复指导，保持 Skill 轻量 |
| `tools/rondo/src/commands/tfs/requirement-tasks.ts` | 接受计划、从父需求构造标题、按稳定身份恢复、依计划对不同子任务关联互不重复的业务 Commit、核验工时 |
| `tools/rondo/src/commands/tfs/writeback.ts` | 为新 Requirement 增加只读 `--inspect`、`--task-plan`、唯一归属/全局占用门禁、计划恢复与后置核对 |
| `projects/multica/workspace-skills/tfs-writeback/SKILL.md` | 更新 CLI 方法与新 Requirement 契约 |
| `projects/multica/08b-requirement-remote-git-delivery.md` | 更新“默认单任务”设计表述 |
| `projects/multica/09-unified-engineer-development-design.md` | 明确 Squad 外 PR Status Sync Agent 为 TFS 规划 Owner |

实施约束：

- 复用 `tools/rondo/src/tfs/api/workitem.ts` 已有工时与 `workitem link-commits` 能力；按**项目 GUID + 仓库 GUID + 完整 SHA**比对 Commit，修复当前只按 SHA 判重导致的错仓复用风险。链接前需检查其他 TFS Task 占用；链接后再次验证目标和全局独占关系。
- 扩展 `tools/rondo/src/tfs/api/query.ts` 现有 `$expand=all` 输出中的 Commit `ArtifactLink` 只读投影，供 `tfs writeback` 与 `verifyTfsWriteback` 校验准确链接；不另建 Commit Link 状态表或新独立 CLI。
- Rondo 的 `delivery/finalize.ts` 保持 Prepare/Complete 边界；增强现有 `verifyTfsWriteback` 的新任务、工时、Commit Link 和 Task 间独占核验。
- `provisioning.json` 已给 PR Status Sync Agent 绑定 `pr-status-sync` 与 `issue-closeout`，不新增绑定或受管 Skill。
- **不改** Workitem Analyst、Engineer、Bug Fix Agent、Delivery Squad、OpenSpec Schema/Template、`spec-preparation` 对 `tasks.md` 的写作契约。
- 保留旧 `dev.dispatch` / Bug Writeback 路径，避免当前其他路线回归。

## 9. 验收标准

1. `tfs.type=需求` 且 PR 完成、Prepare PASS 时，Agent 能由 `tasks.md` 生成 1、3、5 个合理任务，并写入每项 0.5–4h 的 OriginalEstimate。
2. 8 个 OpenSpec Tasks 可归并为 3 个 TFS 子任务；不要求一对一、不反向修改 `tasks.md`。
3. 计划缺失、任务数超限、工时越界、引用不存在、类型未知时不产生 TFS 子任务副作用。
4. 创建 1–N 个任务后模拟中断，重跑仅补缺失项，不产生重复任务/父项评论。
5. 新建子任务按“原 TFS 需求标题 - Task summary”命名；重试按父链与 Description 身份标识认领，不能仅以标题匹配；重复身份、旧任务混用、工时外部修改或计划冲突时安全停止。
6. 新任务解决后核对 OE、RW、CW 与已解决状态；缺少 OE 不能按新规划路线静默 PASS。
7. 每个新 Requirement TFS Task 至少有一个真实、独占的业务 Commit；同一 Commit 不能关联两个 Task（包括其他 Issue 的 Task），按完整仓库身份、SHA 和 TFS 双向关联回读。重复提交、错仓、仅父需求链接、全局占用或读回不明均阻断 `Writeback PASS` / Issue `done`。
8. 当只有 1 个真实可用 Commit 时，只能规划 1 个 TFS Task；1–5 的数量约束与 0.5–4h 工时约束冲突时须明确停止，不生成额外 Commit 或低报工时。
9. TFS 部分成功、失败或结果未知时 Issue 不进入 `done`；恢复不要求重新运行 Engineer，已成功的 Commit 关联不重复写入。
10. `Bug` 不规划或创建 TFS 子任务，仅执行原有父项回写。
11. 旧 Task Set Requirement、远端 OpenSpec Archive、PR Status Sync、原有 Writeback/Finalize 和跨 Runtime 恢复测试通过。
12. TFS 2018 Update 3.2 的 Commit→Work Item 反向查询在真实环境验证有效；两个 Issue 竞争同一 Commit 或 API 无法确认全局关系时不得产生违反独占规则的自动完成结果。

## 10. 明确不做

- 不新增 `TFS Planning Agent`、`tfs-task-planning` Skill、第二套 Task Dispatch 或任务状态机。
- 不要求 Analyst 在 `tasks.md` 中编写 TFS 工时；不以 1–5 个 TFS 子任务限制 OpenSpec 工程任务数量。
- 不新增独立 TFS 工时数据库；不估计/宣称真实人员投入工时。
- 不强制 OpenSpec Task 与 Commit 一对一。**Commit→TFS Task 为多对一，不能一对多**：若真实可用 Commit 不足，则减少 TFS Task 数或阻断，绝不能用一个 Commit 填多个任务，也不能创建无意义 Commit。新 Requirement 不再自动将业务 Commit 同时链接至 TFS 父需求。
- 不处理跨 Issue 的工时预算、排期、人员分配或复杂自动调优。

**实施状态（PR #137）**：Rondo CLI、Agent、Skill 和模拟测试已提交开发分支；TFS 2018 Update 3.2 的跨 Project 反向关联及跨 Runtime 排他写入尚须在真实环境验收。未通过前独占写回维持 fail-closed，不视为已上线。
