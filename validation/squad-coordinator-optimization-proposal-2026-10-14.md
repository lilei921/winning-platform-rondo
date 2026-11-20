# Squad Coordinator 优化建议

> 日期：2026-10-14  
> 状态：PROPOSED；本文件是设计建议，不代表实现或验收通过。  
> 输入：[验证计划](./squad-coordinator-validation-plan.md)、[复核报告](./squad-coordinator-poc-result-2026-10-14-verified.md)、01 指导规范及 02 Delivery 生命周期。计划引用的 `multi-squad-coordination-design.md` 当前不在对应目录，未假定其未提供内容。

## 1. 推荐决策

保留 Multica 的 Issue、Assignment、Squad、Run、Autopilot 和原生交接；把容量计算、选队、改派和回读收敛到一个有界的确定性派工入口。Coordinator Agent 保留为薄调用层和语义异常入口。

第一阶段采用**一个资源池、一个固定执行主机、一个自动派工写入口**。多台机器可以承接交付 Run；控制面的多机并发写入不是多机交付的前提。

这符合现有 Native First / KISS 原则：01 明确允许为批量处理、副作用幂等与恢复增加必要 Script/Gate；02 要求明确事实已经决定的动作不由 LLM 重新裁量。派工脚本只保障一次原生 Assignment 操作，不接管 Agent Run 调度、Delivery 生命周期或 OpenSpec 状态。

### 为什么不继续仅调整提示词

- S04 证明了当前执行路径可以识别空闲队伍却不执行分配；本轮模型把“仅扫描”解释为只读。
- S05 首次失败包含测试配置缺陷：线上指令没有容量检查。它不能证明一个正确串行执行的确定性分配器必然超配。
- 新 Fixture 已证明单次改派可启动目标 Lead，已占用时可保持 WAIT。应复用这两项机制。
- 现有结果没有覆盖正确容量检查下的双请求竞争、写超时和进程崩溃，因此不能把它们当作已解决。

只修提示词可以用于缩小 PoC 问题；正式方案中，容量和写入规则应能被程序检查。语义判断继续由 Agent 承担。

## 2. 职责和最小流程

```mermaid
flowchart LR
    W[Wayfinder 准入和能力要求] --> Q[Multica 上的待分配 Issue]
    Q --> C[Coordinator 薄调用层]
    A[Autopilot 定时唤醒] --> C
    C --> D[同一个确定性派工入口]
    D -->|无可用容量| Q
    D -->|一次 Assignment Update| S[Delivery Squad]
    S --> L[原生 Leader Run]
    D -->|事实未知或冲突| H[保留证据并人工处理]
```

| 责任 | Owner | 明确边界 |
| --- | --- | --- |
| 判断是否 eligible、需要哪些能力 | Wayfinder | eligible 不等于编码授权，不根据瞬时空闲重复做业务准入 |
| 能力要求不明确、Squad 适配有歧义 | Coordinator / Human | 形成持久可读的候选集合，不能越过容量约束 |
| 完整读取、计算占用、选择候选、改派、对账 | 一个确定性入口 | 初次触发和 Sweep 调用同一实现 |
| 启动和排队 Run、Squad 内协作 | Multica 与 Delivery Lead | 保留原生机制和既有审批 Gate |

首版继续允许 Issue-owned Coordinator Run，以减少对已验证交接的改动。Autopilot 使用 run_only 调用同一入口；薄 Agent 必须执行该入口并回报结构化结果。若未执行命令就完成 Run，验收应记失败，不接受自然语言“已扫描”作为成功。

Autopilot 仅是唤醒机制。CLI/helper 名称和参数须在实现时正式定义，不在此文把尚未存在的命令当成可执行能力。薄 Agent 仍可能漏调用脚本，因此原生 Run completed 不能等同于派工成功：应检查脚本执行证据、最近一次成功 Sweep 与队列最长等待时间，超过阈值明确告警。若要求严格有界的自动恢复时间，应采用确定性定时器直接调用同一入口，或平台提供的确定性执行能力；不能靠提示词承诺该保证。替换正式唤醒入口须单独批准和验收。

## 3. WAIT 是本轮结果，Issue 保留派工意图

移除生产契约中的 `Mode=HANDOFF|WAIT|SCAN` 测试控制字符串。`WAIT` 表示本轮没有容量；下一轮仍重新评估同一 Issue。

推荐待分配集合由下列事实推导：

- 属于获准自动派工的 Workspace/Project，且是顶层 Delivery Issue。
- 当前 Owner 为 Coordinator，Status 为已验收的 `todo`。
- 有有效的 eligible 证据，来源版本仍匹配；未被 Human 暂停、取消或改派。
- 能力要求或候选 Squad 集合可读且有效。

保留现有准入证据，不复制一份完整准入状态。确需机器可读的引用时，使用原生 metadata/custom property；精确写接口、版本检查及字段原子性均需在部署版本补验。

| 派工返回结果 | Issue 处理 |
| --- | --- |
| ASSIGNED | Owner 已是目标 Squad；由原生交接启动 Lead |
| WAIT_CAPACITY / WAIT_RUNTIME | 保持待分配条件；下轮自动评估 |
| NOOP | 已由正确 Owner 接管、已终态或不再属于自动入口；不重复写 |
| UNKNOWN | 暂停涉及的写操作，保留未知请求和资源占用，不当作空闲 |
| NEEDS_HUMAN | 依据既有人工入口处理；保持清晰原因及恢复条件 |

队列不依赖 Comment 文本过滤，不通过写 `blocked` 表示暂时无容量，也不把 WAIT 固化为永久跳过。优先级相同时按入队时间和 Issue ID 稳定排序；先实现可解释的固定顺序，暂不引入复杂评分或负载预测。

## 4. 容量的对象与释放条件

首版 `capacity=1` 定义为**每个 Squad 至多承接一个未释放的顶层 Delivery**。它覆盖分析、人工审核、开发、验证和 PR 等阶段。因此 `analysis_review`、`blocked`、`in_review` 都会占用；这是保守吞吐策略，应明确接受其成本。

Run 数量、Runtime online 和业务容量是不同事实：Run 完成不代表交付完成；Runtime online 不保证目标目录、权限或成员工具可用。状态键根据 Workspace 状态目录解释；无法识别的状态返回 UNKNOWN，不默认为终态。

占用计算需考虑：

1. 目标 Squad 已拥有的顶层非终态 Delivery。
2. 尚未对账完成的派工尝试和旧执行残留。
3. 顶层 Issue 已终态但相关 queued/running Run 尚未结束的情况。

计数时按 Delivery ID 去重：一次已反映到 Owner 的派工尝试不能重复算一份占用。Development Child 不独立占一份 Squad Slot，但释放父级时要检查相关 Child/成员执行是否仍在使用资源。

**容量统计的范围必须覆盖整个资源池。** 待分配队列可以限制在某 Project；若某 Squad 被多个 Project 共用，不能用该 Project 的列表推导全局空闲。分页必须完整，权限不可见或分页失败视为 UNKNOWN。

安全释放需要同时满足：Delivery 已确认终态、相关活动/排队执行已收敛、该交付持有的工作目录等独占资源已可释放、没有未决派工请求。超时不自动等于释放；不能用租约过期掩盖仍在运行的旧任务。

首版优先给各 Squad 独立的本地 checkout/workdir。若两个 Squad 共享同一不可并发目录，还需按实际共享资源限制容量；单独统计 Squad 数量不能解决文件冲突。

## 5. 先建立单写入口，再决定是否需要服务端扩展

### 首版：受控的单入口

- 固定一个派工执行主机；所有初次派工和定时 Sweep 进入同一确定性操作。
- 对整个资源池的“回读 → 决策 → 写入 → 对账”持有进程间互斥。锁位置必须稳定，不能落在每个 Run 各自的临时目录。
- `max-concurrent-tasks=1` 作为额外限流，不能替代执行层互斥。
- 从取最新事实开始到确认写入结束保持互斥；不持有锁等待整项 Delivery 完成。
- 单次扫描有数量/时间上限，返回后由下一次 Sweep 继续，避免长 Run 与重复定时唤醒积压。
- 只有所有派工写入都遵守该入口时，才能对这个入口承诺不超配。人工绕过和其他客户端直接指派必须被权限限制，或被明确视为打破该保证的操作；文档约定本身不是强制执行。

第一阶段不增加独立任务数据库、分布式消息队列或项目级 Workflow Engine。Multica 继续拥有 Issue 与 Assignment；进程锁仅用于互斥，操作日志仅用于恢复与审计，不另设第二份业务 Owner/Status。

### 多写入口是硬需求时

若要求多个 Coordinator 实例、热备主机或人工直接指派同时工作，又要求严格 `capacity=1`，应在服务端实现或验证等价的原子操作：同一事务校验 Issue 版本、候选资源容量、分配占位和 Owner 变更，并使 Run 启动具备可靠投递与去重。所有相关写路径都必须受该约束，单独新增一个可被绕过的 API 不足以成立。

不建议在多个 Agent 中各自实现“查列表再改派”，也不建议用可过期的普通锁文件模拟跨机资源锁。

## 6. 同一 Issue 的并发修改与请求结果未知

本轮额外查证：固定 commit `2ea01ae4e` 的官方 Issue handler 存在 `expected_revision` 请求字段、版本冲突检查和更新参数传递；本机 CLI 的 `issue update --help` 没有对应参数。**这说明不能把 CLI 未暴露能力等同于服务端没有版本控制。** 部署中的 Server 版本未独立确认，需在隔离环境验证实际 HTTP 接口的冲突行为和原子性，再决定 API adapter 或 CLI 扩展。[官方源码](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/handler/issue.go)

版本条件保护同一 Issue 的旧写覆盖；两个不同 Issue 的版本都可以匹配，仍可能竞争同一个 Squad，所以它不能单独提供资源池容量约束。

建议在原生 Issue metadata 中持久化最小派工尝试记录：attempt ID、目标 Squad、来源/决策版本、发送前观察到的 revision、结果是否待对账。接口需先补验；该记录不应再次拥有 Delivery 状态。

每次派工顺序：在互斥内读取准入和占用 → 持久化并回读尝试记录 → 重新读取 Issue revision → 提交一次 status/assignee 联合更新 → 分别回读 Owner 和目标 Run。写日志不能悄悄使所用 revision 过期。

| 观察到的结果 | 恢复规则 |
| --- | --- |
| Owner 已变为目标，Run 已存在 | 不重派；关联已有 Run |
| Owner 已变为目标，暂未看到 Run | 保持占位，有限次只读对账；不能反复改状态强行唤醒 |
| HTTP 超时/连接中断 | 结果 UNKNOWN，保留该目标的预占，不立即给另一个 Issue 使用 |
| Owner 被 Human 或其他合法入口改变 | 尊重新 Owner，停止覆盖并重新判断 |
| 进程重启且有未决尝试 | 先对账再分配；无法确认的资源保持冻结并告警 |

一次超时后的“当前仍是旧 Owner”不证明请求永远不会提交。部署版本未证明条件重试安全前，不盲发第二次写入；也不通过切换另一个 Squad 绕过未知结果。原生 metadata 写入同样可能超时，只有其记录被确认后才进入下一步。

## 7. 减少唤醒副作用，明确交接边界

- 保留一次 Update 同时设置 `todo + assignee` 的已验证路径。
- 改派后 Coordinator 不再写交付状态，也不通过普通 Comment、Mention 或 rerun 追着 Leader 确认。
- 交接证据优先写 Run 输出和已验证不会触发派工的结构化字段。显式 Comment 与平台自动生成的最终输出 Comment 需分别验证，不能统称为同一种“无唤醒 /note”。
- 目标 Leader 在执行有副作用的动作前确认自己仍是合法 Owner，并识别已经完成的相同动作；不能把 Run 不重复视为业务副作用 exactly-once。

固定版本源码明确表示，改派和变更终态都不自动取消现有任务。已验证的新旧 Run 短暂重叠应通过写权限和幂等边界处理。[官方源码](https://github.com/multica-ai/multica/blob/2ea01ae4e/server/internal/handler/issue.go)

## 8. 下一轮只验证能改变决策的场景

先冻结一套 fixture：CLI/Server/Daemon 版本、线上 Agent instructions、Autopilot description、Roster、Status catalog、脚本版本与摘要哈希。每次改配置形成新轮次；测试输入表达需求和能力，不直接写出应该返回 HANDOFF/WAIT 的答案。

| 顺序 | 验证项 | 必须看到的证据 |
| --- | --- | --- |
| 1 | 线上指令与发布资产一致，薄 Agent 实际调用确定性入口 | 配置回读、脚本版本、结构化输出；缺少调用即失败 |
| 2 | S04：同一 Issue 先等待，释放容量后自然 Sweep 接管 | WAIT → 释放 → 自动改派 → 唯一目标 Run → 下一 Sweep 无重复副作用 |
| 3 | S05：A 空闲，两个新 Issue 同时竞争；初次触发与 Sweep 竞争 | 全程最多一份占用；第二个 WAIT；释放后只放行一个 |
| 4 | S06：写成功但响应丢失，及发送前后进程崩溃 | 不超配、不盲重派；重启先对账；未知占用保留 |
| 5 | S07：跨 Project 共用 Squad、分页失败、Child 活跃、Runtime 不可用 | 不漏占用、不把未知当空闲、不因父 Issue done 提前释放 |
| 6 | 旧 Owner 回写、人工改派、重复 Comment/Trigger | 不覆盖新 Owner、不重复执行交付副作用 |

S06 和 S07 中这些子项应提升为正式自动派工的准入条件。S01 的当前跨 Host 与 Git 隔离证据可保留；“必须是不同物理机器”是否是业务要求应单独确定，不能用硬件身份问题替代文件系统隔离验收，也不能事后修改旧用例来抹掉原 BLOCKED。

建议第一阶段的上线边界是：单派工执行主机、统一受控入口、有限资源池、每 Squad 一个未释放 Delivery、失败可见且保守停止。只有并发、超时和恢复均通过，才扩展到多入口或自动故障切换。
