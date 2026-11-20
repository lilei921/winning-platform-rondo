> 本包镜像；权威来源：spec-preparation/references/tasks-md-authoring-contract.md。

# tasks.md 写法契约（D1 迁移后的唯一维护源）

> 迁移来源：`workitem-analysis/references/tasks-md-authoring-contract.md`（2026-10-26 冻结契约）。**原有格式、TFS 预估上限、Gate 和 Writeback 语义不变。**
> D1 阶段已保留旧路径兼容副本；D2 **目标配置**解除旧 Skill 绑定后，旧目录及副本仍保留为 Retired 历史快照，不再作为现行规则发布或维护。实际远端切换是否生效必须回读，未切换 Workspace 仍可在授权回退期间使用旧副本。不得分别修改两份规则；以后如需删除必须另行批准。TFS 预估职责调整属于独立 D3-B 决策。

## 1. 任务预估时长（`[预估: Nh]` 尾注，需求必填 / Bug 可选 + TFS 工时字段与描述）

**链路**：Analyst 在 tasks.md 每个 task 声明**行末**尾注 `[预估: Nh]`（N 为正数、≤6h）→ Analysis Gate 强制校验 → PR 通过后由 `rondo tfs writeback` 物化子任务时写 TFS 工时字段（2026-10-30 TFS 剥离后消费者从派发期物化脚本改为收口 writeback；原 `tfs materialize-tasks` 标 deprecated 仅作在途恢复）。6h 上限的价值不在估算精度，在**拆分纪律**——超过 6h 说明粒度太粗，Gate 打回重拆（机器可判定）。

**类型分支（tfs-bug-delivery-task-skip-plan §4.4，2026-10-26）**：仅 `tfs.type=需求` 的 Delivery 强制本尾注；`tfs.type=Bug` 不建 TFS 子任务、尾注无下游消费者，**可选**——Analysis Gate 的 `task_estimates` 检查对 Bug 输出 skipped，已写尾注不报错（向后兼容存量 Change）。

**格式契约**（唯一权威正则，Gate 与物化共用同一定义）：

```text
行末匹配：/\s*\[预估:\s*(\d+(?:\.\d+)?)\s*h\]\s*$/i
合法：N > 0 且 N ≤ 6；尾注必须在 task 声明行行末（不在行末 = 格式非法）
```

1. **Analysis Gate 校验**（`delivery-gate` 的 `rondo analysis validate`，用户裁定：必填）：逐 task 声明行校验——缺尾注 / N≤0 / N>6 / 尾注不在行末 → Gate FAIL（理由列明 ref 与原因）；**tfs.type=Bug → skipped 不强制**；
2. **物化扩展**（`rondo tfs writeback` 的任务物化步；deprecated 的 `rondo tfs materialize-tasks` 同口径）：
   - 前置校验：全部待物化 ref 的行文本含合法尾注，任一缺失/非法 → **exit 2 零写入**（正常流程 Gate 已拦截，此前置防绕过）；
   - 标题剥离尾注（见 §2）；描述文件追加一行 `预估: Nh`；
   - rondo `workitem create` 的 `--estimate <hours>`：创建时写 `Microsoft.VSTS.Scheduling.OriginalEstimate` 与 `RemainingWork`（均为 N）；**CompletedWork 创建时不写**——在任务置"已解决"时由 `set-state --complete-with-estimate` 确定性落库 CW=OE（2026-10-20 用户裁定；本流程工时为预估口径，实际工时填报仍属人工）；
   - reused/adopted 路径**不补写**工时（既有任务的预估值以其创建时为准，避免重写历史事实）。

## 2. TFS 任务标题简化（源头约定 + 脚本兜底）

**两层修法**：

1. **源头约定**（当前 `tasks.md` 写法契约，由 `spec-preparation` 按需引用）：task 声明首分句为"动作+对象"短标题（≤30 字），实现细节进 task 描述/验收条件——不机器校验（分句边界是语义判定，不确定），靠约定 + 下层兜底；
2. **脚本兜底**（`rondo tfs writeback` 的任务物化步）：标题正文（剥离预估尾注后）确定性截断——`TITLE_TEXT_MAX = 80` 字符，超出截断 + `…`；prefix `[<issueKEY> <ref>]` 不参与截断（身份前缀完整保留）；**完整行文本**追加进 TFS 描述（一行 `Task: <原生行文本>`，标注来源 tasks.md，TFS 侧不丢信息）。

**兼容性**：孤儿认领按 `title.startsWith(prefix)` 匹配，截断只发生在 prefix 之后，认领路径不受影响。存量已创建任务不改标题（重写历史事实无收益）。
