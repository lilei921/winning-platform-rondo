# TDD（Test-Driven Development）

> **本文件为 TDD 方法的唯一权威**（语义背景：04 §6.2，根级现行版 `projects/multica/04-engineer-development-design.md`）。本文件是 `development-execution` 的内部 Method，不注册为顶层 Skill，不拥有独立 Run / Issue / Side Effect。

## Use When

行为可稳定自动测试：Business Rule、Domain Logic、Service / API Contract、Pure Function、Bug Regression。
**不适用**：复杂 Layout / CSS、环境配置、Migration / SQL、Generated Code、外部系统或人工交互为主、无法构造有价值 Test Seam 的场景——返回父 Skill 选择其他 Feedback（04 §6.2），不为形式测试内部实现细节。

## Input

- 当前 `task_ref` 的可观察行为（Requirement / Scenario 或 Corrective Expected）；
- 目标仓测试框架事实（见领域 Skill 的 local-validation / feedback-signals）。

## Procedure

```text
Select Observable Behavior / Test Seam
→ RED：先写测试并运行，证明目标行为尚未满足（有针对性的失败，不以任意失败冒充）
→ Minimal GREEN：最小实现使测试通过
→ Safe Refactor：保持 GREEN 前提下整理实现，不改变已批准 Contract
→ Next Behavior
```

## Output

- RED → GREEN 的实际执行证据（测试名、失败/通过输出引用）；
- 与生产实现关联的测试代码（进 Candidate Commit）。

## Allowed Effects

- 在批准边界内编写/修改测试与实现代码。

## Forbidden Effects

- 不改变 Requirement / Scenario / External Contract；
- 不创建 Multica Issue / Run、不写 Issue 状态、不调其他 Method 或 Skill；
- 仓内无测试运行器时不得伪造 RED/GREEN（改走领域 Skill 的替代 Signal）。

## Stop

- 找不到有价值的 Test Seam → 回本 Skill 调用方换 Feedback 形式；
- RED 无法归因于目标行为缺失（环境/依赖问题）→ 停止并按父 Skill Failure 节处理。
