---
name: backend-engineering
description: 后端技术领域方法（Java / Spring、API / Service / Persistence、迁移与事务、后端测试策略）。Backend Engineer 在执行 assigned Task Set 的研发闭环中，需要领域级反馈信号选择、本地验证命令映射或工程标准审查依据时使用；与 development-execution（研发入口）配套，不单独构成研发流程。
---

# backend-engineering

## When

- Backend Engineer 执行 `development-execution` 过程中，需要回答"后端改动用什么反馈信号证明收敛"（Establish Feedback / Implementation）；
- 需要执行 Required Local Validation，查后端仓的实际命令映射；
- Code Review 的工程标准轴需要后端领域细化依据（迁移安全 / 事务 / 兼容）。

## Input

- 当前 `change_ref` + `task_refs` 与批准边界（来自派发，见 `development-execution` Input）；
- 目标业务仓枢纽克隆 `<root_repo>/<repo_path>/`（研发在其内切特性分支进行；契约唯一权威：`references/repo-write-isolation-contract.md`（本包镜像，权威属 pull-request Skill））。

## How

执行 `development-execution` 的自主研发循环与确定性交付契约；本 Skill 不提供第二套流程，领域方法按需查表：

| 专业环节 | 查什么 |
|---|---|
| Establish Feedback / Implementation | `references/feedback-signals.md`——按改动类型选最小可靠 Signal |
| Local Validation | `references/local-validation.md`——DF 后端仓实测命令映射；映射表未覆盖的项标 UNKNOWN，不虚构命令 |
| Code Review（工程标准轴） | `references/review-standards.md`——后端维度细化（迁移安全 / 事务 / 兼容 / 错误处理） |

## Validation

- 所选反馈信号与 `task_refs` 的改动类型对应，且实际执行（不是"应该能跑"）；
- Local Validation 每项检查有命令、退出码、关键输出记入 Evidence；
- Review Finding 引用本文件或 references 的具体条目作为判定依据。

## Output

- 反馈信号选择与实际执行结果（进 `evidence.json` 的 verification 段）；
- Local Validation 逐 check 结果（进 evidence 的 local_validation 段）；
- 工程标准轴 Findings（进 evidence 的 code_review 段，五要素齐全）。

## Failure

- 命令映射表无对应项 / 命令实际不可执行：标 UNKNOWN 并说明，不得把未执行的检查写成 PASS；
- 所选 Signal 无法建立（如无 Test Seam）：回 `development-execution` 换其他反馈形式，不伪造 RED/GREEN；
- 领域方法与批准契约冲突（如修复必须改已批准外部接口）：停止，按 `development-execution` 的 Failure 节升级。
