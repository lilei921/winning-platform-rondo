# Method Skill Library Implementation Design（方法 Skill 库实施设计）

> Version: 1.4.4  
> Date: 2026-11-28  
> Scope: 可复用场景方法、Native Workspace、工程方法与 Skill 治理。

<a id="method-section-01"></a>
<a id="section-1-1"></a>

## 1. 设计原则与职责

遵循 [01](01-multica-openspec-design-guideline.md) 的 Specialist Focus、One Rule One Owner、Native First、Minimal Sufficient。Agent 决定目标、语义、适用范围与方法；Skill 提供可复用的场景执行方法；Rondo CLI 负责确定性校验、执行、持久化事实。Skill 不是独立业务角色或状态机。

仅在有真实复用价值与清晰边界时提取方法。单次使用、已有稳定原生命令或简单说明不必额外包装。Agent Instructions 不重复 Skill 步骤；Skill 不复制 CLI 可确定检查的规则，不写历史机制或固定执行链。

<a id="method-section-03"></a>
<a id="method-section-04"></a>

## 2. 当前受管 Skill 与绑定

以 [provisioning.json](workspace-config/provisioning.json) 和 [skills/README.md](skills/README.md) 为实际配置来源。

| Skill | 方法边界 | 当前绑定 |
|---|---|---|
| [codebase-explorer](skills/codebase-explorer/SKILL.md) | 工程上下文、调用关系与影响定位 | Wayfinder、Analyst、Bug Fix |
| [bug-analysis](skills/bug-analysis/SKILL.md) | 需求中纠正性工程问题的分析 | Analyst |
| [requirement-analysis](skills/requirement-analysis/SKILL.md) | 需求澄清、行为与工程增量识别 | Analyst |
| [spec-preparation](skills/spec-preparation/SKILL.md) | 确需变更时准备最小 OpenSpec 契约 | Analyst |
| [analysis-publish](skills/analysis-publish/SKILL.md) | 提交审核所需的发布与异常处理 | Analyst |
| [diagnosing-bugs](skills/diagnosing-bugs/SKILL.md) | 直接 Bug 诊断与修复方法 | Bug Fix |
| [native-workspace](skills/native-workspace/SKILL.md) | 按需准备原生 Checkout | Analyst、Engineer、Bug Fix |
| [pull-request](skills/pull-request/SKILL.md) | 候选分支、PR 准备、物化及交付 | Engineer、Bug Fix |
| [workitem-finalize](skills/workitem-finalize/SKILL.md) | 已确认 PR 终态后的归档、回写、完成 | PR Status Sync |

Delivery Lead、TFS Sync、Vayne 直接使用适用的原生或 Rondo 命令，不为单一确定性操作新增 Skill。PR 状态同步由 Agent Instructions 直接调用命令，再按已确认结果调用收口 Skill。不存在默认的固定 Verify Skill/Agent 绑定；Human 需要独立验证时按实际可用成员处理。

<a id="native-workspace"></a>

## 3. Native Workspace（工作区准备）

唯一现行方法见 [native-workspace/SKILL.md](skills/native-workspace/SKILL.md)。根仓及业务仓是 Multica Task workdir 下平级的独立 Git Checkout；不假定根仓/子仓两级目录，不以固定本地绝对路径寻找工作区。

### 3.1 工程根仓

按当前 Project Resource 获取 url/ref。首次 Requirement 必须有明确 Resource 分支；其他允许无 ref 的场景按原生语义处理。已有分析发布事实的 Requirement 使用 `analysis.source.repo_url` 和 `analysis.source.branch`，Engineer 确认获批 Commit 可用。

```bash
multica repo checkout <root-url> --ref <resource-ref>
rondo runtime check-checkout --root-repo <实际返回路径>
```

消费原生命令返回的实际路径，已有可信 Checkout 优先复用。只读调查能够通过 MCP 完成时不强制 Checkout。

### 3.2 业务仓

按 Project Resource 的 url/ref 获取实际仓库，核实 Git Origin。只读 Checkout 不创建 Candidate。获授权的研发使用完整仓库名称，按 Requirement 批准 Scope 或直接 Bug 的真实修复范围处理：

```bash
rondo repo get-branch --project <project> --repo <repo> --branch feature/<tfs.id>
```

若远端 Candidate 存在，以其为 Checkout ref；确认不存在才使用 Resource ref。未知结果停止。复用原生 Task Branch；检查候选版本和仓库身份。重入时 Fetch 并核实当前 HEAD 包含 Candidate，不擅自切换 ref、merge、reset、clean 或覆盖未知本地改动。PR 新建目标分支取 Resource ref；已登记 PR 以已固定事实为准。Candidate 的 Push、Prepare、Materialize 归 [04](04-engineer-development-design.md)。

### 3.3 跨 Run 恢复

工作区不作为长期权威事实。Analysis Source、Git Candidate、已登记 PR 提供可恢复的固定身份；Multica 原生 Task Context 提供本次 Issue、工作路径与环境。跨 Runtime 收口使用 `rondo repo prepare-archive` 的实际返回路径，按 [02](02-multica-delivery-lifecycle-design.md) 执行，不依赖 Analyst/Engineer 原本的机器。不得另建持久化工作区管理服务。

<a id="method-section-09"></a>
<a id="method-section-19"></a>

## 4. 按需组合与 MCP

Wayfinder 的准入仅调查足够判断的业务范围、仓库及处理能力；已核实结论可被 Analyst / Bug Fix 复用。Analyst 根据当前 Issue 区分无变更、工程增量和证据不足，再按需使用分析、准备、发布能力。Engineer / Bug Fix 根据实际修改、工作区和交付事实选择必要方法，不固定调用全部 Skill。

Project Resource 的 label 用于候选仓库发现，实际源码决定实现归属。remote-codegraph 用于调用关系、Symbol 和影响探索，remote-filesystem 用于读取实际文件，remote-ripgrep 用于定向搜索；按需使用，不限定阶段，不要求先检出所有仓库、不将远程索引当作当前本地 Candidate 的真实验证。MCP 的配置与权限以 [mcps/README.md](mcps/README.md) 和 provisioning 为准。

<a id="method-section-10"></a>
<a id="method-section-11"></a>
<a id="method-section-12"></a>
<a id="method-section-13"></a>
<a id="method-section-14"></a>

## 5. 工程方法（非强制额外 Skill）

| 方法 | 适用与最小产出 |
|---|---|
| Defect diagnosis | 核实 Expected/Actual、复现条件、根因假设与反证，形成最小可验证修复方向 |
| TDD | 适用于可稳定自动测试的行为；真实 RED、最小 GREEN、安全 Refactor |
| Codebase design | 局部选择、Seam、Adapter、接口与数据流；不扩大范围做无关重构 |
| Code Review | 针对当前候选版本检查工程质量与契约一致性，区分 Blocking 和已说明风险的 Non-blocking Finding |
| Verification before completion | 执行适用的实际验证；未运行、失败或证据不明如实记录，不把推测当 PASS |

实际专业结果约束见 [03](03-workitem-analysis-design.md)、[04](04-engineer-development-design.md)。这些方法不是新增注册的 Skill、Gate 或流程阶段；无需生成单独报告或持久化中间模板。

<a id="method-section-05"></a>
<a id="method-section-06"></a>
<a id="method-section-07"></a>
<a id="method-section-08"></a>
<a id="method-section-15"></a>
<a id="method-section-16"></a>
<a id="method-section-17"></a>
<a id="method-section-18"></a>

## 6. Skill 组织、来源与副作用

- 项目原生方法优先；必要时引用或内置成熟方法，记录来源、版本与许可，避免盲目同步上游或引入不适用机制。方法内容与实际执行边界冲突时，以当前授权和项目契约为准。
- SKILL.md 仅保留适用场景、必要输入、方法、真实输出、异常处理与必要边界；复杂可复用资料才拆 references。没有真实需要不建立内部方法全局 Registry、方法调度器或额外状态。
- 读操作按需复用；写操作通过当前授权和对应 Rondo/Multica/Git 原生能力执行。失败或 UNKNOWN 时核实已有外部事实，不重复不可确认的副作用。
- 事实持有方见 [01](01-multica-openspec-design-guideline.md)：专业结论可在普通 Comment 或工程契约内保留；CLI 登记跨阶段机器事实；不新增通用 Skill Result、facts.json 或重复验证记录。

<a id="method-section-20"></a>
<a id="method-section-21"></a>

## 7. 实现与验收

实际绑定、Skill 内容、MCP 配置和同步机制以仓内 provisioning、skills、mcps 及 [Rondo CLI](rondo/COMMANDS.md) 为准。Skill 修改后使用现有同步机制，核实实际 Workspace 的 Skill 与 Agent 绑定，不以文件已提交等同运行部署成功。验收重点为按需组合、正确权限、无重复 Gate、原生 Checkout 与 Candidate 恢复、真实证据及异常停止；运行验收归 [07](07-multica-openspec-implementation-roadmap.md)。
