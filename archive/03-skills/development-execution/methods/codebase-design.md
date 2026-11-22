# Codebase Design（局部设计方法）

> **本文件为局部设计方法的唯一权威**（语义背景：04 §6.3，根级现行版 `projects/multica/04-engineer-development-design.md`）。本文件是 `development-execution` 的内部 Method，不注册为顶层 Skill，不启动独立架构评审 Runtime。

## Use When

模块边界、Adapter / Interface Seam、数据流或测试可达性影响当前任务的正确实现，需要在写代码前把局部设计想清楚。

## Input

- 当前 `task_ref` 与批准边界；目标仓现有架构/命名/错误处理约定（Ground 已读）；
- 存在时的 `design.md`（批准的技术决策，只可细化不可改变）。

## Procedure

1. 定位改动落点：哪个模块/层，与现有谁的边界相接；
2. 识别 Seam：需要新增/调整的接口、Adapter、数据流节点；
3. 优先复用既有机制（仓内已有模式优先于引入新模式）；
4. 评估测试可达性：设计是否让 feedback-signals 选的 Signal 可落地；
5. 局部设计自洽即可定稿，写入实现；需要沉淀的决策记入 `design.md` 的批准边界内细化（04 §3.4 权限表）。

## Output

- 局部设计结论（体现在实现代码与必要的 design.md 细化中）。

## Allowed Effects

- 批准边界内的局部结构决策：类/函数拆分、内部数据结构、组件组织、非 Contract 级重构。

## Forbidden Effects

- 不改变跨 Repository Contract、数据库重大迁移、安全模型、已批准外部接口——出现此类需要必须停止协调（04 §6.3）；
- 不变更批准 Scope，不启动独立评审流程。

## Stop

- 设计推演发现必须越出批准边界 → 停止，按父 Skill Failure 节升级（Goal / Reason / Scope Impact）。
