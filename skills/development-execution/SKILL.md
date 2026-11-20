---
name: development-execution
description: Engineer 收到已批准的 change_ref + task_refs 派发后，在业务仓枢纽克隆内自主实现与验证，并通过确定性检查交付代码、Evidence 和任务进度；Backend / Frontend / Flink Engineer 共用。
---

# development-execution

## When

- 收到 Issue @mention 派发（`change_ref` + `task_refs`），或拥有 Development Sub-Issue；
- 根仓存在对应 OpenSpec Change，Issue 上有有效 Human 批准且附加条件已满足。缺失或批准基线无法核对时停止，不开始实现。

## Input

- 派发评论中的 `change_ref`、assigned `task_refs`、批准边界与 `verify_agent` 结论；
- `openspec/changes/<change_ref>/` 的 `proposal.md` / Specs / `design.md` / `tasks.md`；
- Issue 的 Analysis Handoff Facts、批准评论与 `tfs.id`。

## How

### Entry Guard（必须先于代码修改）

- 读取已批准的工程契约、当前 `change_ref`、assigned `task_refs` 和真实 Human Approval 引用/条件，不自行扩展范围。派工检查的 PASS 仅证明派发事实，不替代对批准来源与条件的核对。
- 配置为**本 Skill 目录**内的 `config/repo-registry.json`；解析为绝对路径供命令的 `--config` 使用。缺失、不可读或 Workspace 身份不匹配则停止，不查找特定 Agent Runtime 目录。
- 执行 `rondo dev check-dispatch --config "<config-path>" --issue <父 Delivery KEY> --task-refs <assigned task_refs CSV> --change-ref <change_ref> --engineer-id <当前 Agent UUID>`：仅 `PASS` 放行；`FAIL`（含 `no_covering`）或 `UNKNOWN` 均停止并向 Delivery Lead 回流原因。
- **业务仓分支准备**：通过每个 Git 子进程的 `cwd` 指定枢纽克隆绝对路径 `<root_repo>/<repo_path>/`，按并发写隔离契约（`references/repo-write-isolation-contract.md`（本包镜像，权威属 pull-request Skill））执行开工三步：`git fetch origin` → `git status --porcelain` 为空（非空 → UNKNOWN 停止，不自行清理）→ `git switch -c feat/<tfs-id> origin/<目标分支>`（分支已存在则 `switch` 挂接即可，不自动 rebase 目标分支；目标分支已前进需同步时回流 Delivery Lead 语义决策）。Windows MXC 下 Git 参数中不得保留 `-C`；不改变 Agent 主进程工作目录。研发全程在该枢纽克隆内进行；同一业务仓同一时刻仅允许本 Issue 在研（同仓串行）；收尾前提交并推送干净。

### Engineering Loop（专业路径自主选择）

在授权范围内按问题需要循环进行代码探索、定位、局部设计、实现、验证和 Review；这些**不是固定串行步骤**。选择最小可靠反馈信号，发现新证据时可以调整内部技术方案，但实质改变已批准 Contract / Scope 必须升级。

- 验证每个 assigned Task 的必要行为及适用的 Build / Compile / Type Check / Lint / Runtime / Contract Check；记录**实际**执行命令、结果、退出码或可复核引用，未执行不得报 PASS。
- 实现代码必须按 `methods/code-review.md` 完成 Code Review，处理 Blocking Findings 并按影响范围复验；未解决的 Non-blocking Finding 必须明确 `blocking: false` 且记录风险/完成影响（`risk_note` 或 `risk_ref`）。必要时可用只读 Reviewer，不创建第二个交付 Owner。
- `methods/tdd.md`、`methods/codebase-design.md`、`methods/bounded-diagnosis.md` 按问题需要加载；声明完成前遵循 `methods/verification-before-completion.md`。无可用 Test Seam 时用有效替代反馈，不伪造 RED/GREEN。
- 领域反馈信号、命令与工程标准从绑定的 `backend-engineering` / `frontend-engineering` 等领域 Skill 的 `references/` 按需读取；**执行任何 Local Validation 命令（build / lint / test）前，必须先读所绑定领域 Skill 的 local-validation（`backend-engineering/references/local-validation.md` 或 `frontend-engineering/references/local-validation.md`，按绑定领域取一）**——验证命令形态与环境契约以它为准，不凭惯性直接跑命令。
- **纯验证 Task Set**：本轮无代码修改时复用现有有效 Candidate、Review 和 PR Preparation，仍执行本轮 Required Verification 并形成当前 Evidence；不得为走流程制造新 Commit/Push 或重复 Review。
- 不直接编辑 `tasks.md` checkbox；其进度仅在 Completion Check PASS 后由 `rondo change update-progress` 受控更新。

### Delivery Closure（顺序与结果必须满足）

1. **Commit / Push**：仅有实际代码变更时，在必要验证与 Review 有效后形成新候选；纯验证引用既有有效候选与 Review 事实。业务仓 Commit Message 必须有独立 `Refs: #<tfs.id>` 尾注行（使用父工作项，不使用 Issue KEY 或新建子任务 ID），不得使用 `fix/fixes/fixed/close/closes/closed/resolve/resolves/resolved #id` 自动迁移关键字；根仓 Commit 豁免。历史在途交付的旧关联规则由 `references/development-evidence-contract.md` 及 CLI 校验决定。
2. **PR Preparation**：按仓判定 `required`；required=true 时执行：

   ```bash
   rondo dev pr-prep --config "<config-path>" --issue <父 Delivery KEY> --repo <repo_key> \
     --change-ref <change_ref> --candidate-commit <40位候选SHA> --title "<PR 标题>" --root-repo "<根仓路径>"
   ```

   title 与描述语义由本 Engineer 撰写：描述文件为 `openspec/changes/<change_ref>/pr-description-<repo_key>.md`（缺失时脚本搭架模板，重跑不覆盖；可执行前自写并 `--description` 指定，或执行后完善）。`PASS` 放行；`FAIL`：`head_mismatch`/`source_branch_not_found` 核对 Push 事实后重跑、仍败回流 Delivery Lead，其余修正入参重跑；`UNKNOWN` 停止并回流 reasons。字段契约见 `pull-request/references/pr-facts-contract.md`；纯验证复用既有准备事实；required=false 记录理由。PR 物化由 Delivery Lead 协调，Engineer 不创建 PR。
3. **Evidence**：按 `references/development-evidence-contract.md` 生成真实 `evidence*.json`（含逐 Task 实际验证依据、当前 Candidate、Code Review / 风险说明、`contract_files` 契约哈希——用 `rondo dev contract-hash --openspec-root <根仓> --change-ref <change_ref>` 取值，勾 tasks.md 进度不改哈希、契约正文变化必须重算回填；不强制新增 `verification[]`），落在 Change 目录顶层供下游 tfs-writeback 消费；Issue 评论只回流摘要和路径，不全文复制。
4. **Completion Check**：必须在声明 READY 前执行并返回 `PASS`（exit 0）；exit 2 `FAIL`、exit 3 `UNKNOWN` 均不得放行。正常业务仓交付必须提供 `--verify-commits`、`--issue` 与 `--registry-config`（后者沿用 Entry Guard 的配置路径），核对真实提交及派工关联。

   ```bash
rondo dev check-completion \
  --openspec-root <根仓路径> --change-ref <change_ref> \
  --task-refs <assigned task_refs CSV> --evidence <实际 evidence 文件绝对路径> \
  --verify-commits --issue <父 Delivery KEY> --registry-config <config-path> --root-repo "<根仓路径>"
   ```

5. **Task Progress Patch**：仅在 Completion Check PASS 后对本次有真实证据的 assigned `task_refs` 执行，不扩大任务范围，不手动勾选：

   ```bash
rondo change update-progress \
  --openspec-root <根仓路径> --change-ref <change_ref> --check <completed task_refs CSV>
   ```

   - `UPDATED` / `ALREADY_COMPLETE` → 核对并继续；后者在 Evidence 标注 `skipped_already`。
   - `BUSY` → 最多重试 3 次，每次间隔至少 30s；仍失败则 UNKNOWN，不发布 READY，保留已验证证据供后续 Run 重放 Patch。
   - `CONFLICT` / `INVALID` → 禁止覆盖或假勾。工具报错与文件目视事实矛盾（如报「目标行不存在」但该行肉眼存在）时，先按 `methods/bounded-diagnosis.md` 做有界鉴别：排除解析层假阳性（行尾 CRLF / 编码 / 编号重复，用最小复现验证），仍不能确认或确认真冲突 → 停止并向 Delivery Lead 升级。
   - 将脚本 stdout JSON 原文记录到 Evidence 对应任务条目；Patch 未确认不得发布 READY。
   - 回读后、发布 READY 前核对 Candidate Commit、批准 Contract 与派工范围仍与本轮 Check 的依据一致；发生相关实质变化则重检受影响范围，不沿用失效 PASS。

## Validation

- 必要 Local Validation 与 Code Review 有可复核 Evidence，候选 Commit / Push 事实真实；
- Completion Check `PASS`，Progress Patch 已确认，PR Preparation Facts 完整；
- Issue 已回流 Evidence 摘要、文件指针、候选 Commit 和 PR Preparation 结论；
- Parent Issue Runtime 不改父 Issue 状态；Development Sub-Issue 仅当其承接的**全部当前 required Task Sets** 均完成且按授权时才置 `done`。

## Output

- 业务仓：有代码修改时提供新候选 Commit / Push；纯验证复用有效候选；
- OpenSpec Change：`evidence*.json`、经 CLI 受控更新并回读的 `tasks.md`；
- Issue：摘要 + 可访问引用，不重复长文档。

## Failure

- 批准缺失/冲突、实际变更需超批准范围 → 停止并向 Delivery Lead 提交事实与回审建议；
- 验证、Review 或 Completion Check `FAIL` → 定向修复并重验；无法确认的 `UNKNOWN` 原样报告，不以推测替代；
- Progress Patch 出错遵循 Delivery Closure 的恢复规则，不重复实现和验证；
- Commit / Push 遇权限或网络失败 → 保留本地 Commit 和阻塞事实，交人工处理，不无限重试。
