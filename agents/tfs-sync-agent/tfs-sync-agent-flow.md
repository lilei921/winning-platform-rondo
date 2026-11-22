# TFS Sync Agent 主流程

> 视角：TFS Sync Agent + `tfs-sync` Skill；以当前 Rondo 实现为准。

## 流程图

```mermaid
flowchart TD
    A([Autopilot / 人工触发])
    B["Agent 使用 tfs-sync Skill"]
    C["Rondo 查询 TFS Work Item"]
    D{"配置、查询与准入 Agent 有效？"}
    E{"还有待处理 Work Item？"}
    F["按 tfs.id 查找 Issue"]
    G{"Issue 已存在？"}
    H["创建 backlog Issue，指派 Wayfinder"]
    I{"来源内容变化或初始化待完成？"}
    J["记录 skipped"]
    K["同步 TFS 来源信息与附件"]
    L{"需要完成初始化？"}
    M["回读确认并清除 pending"]
    N["记录 created / updated"]
    O{"存在单项 failed？"}
    P([汇总结果，正常结束])
    Q["报告失败，按需有限重试"]
    R{"异常结果可确认？"}
    S["记录 failed，继续下一项"]
    U["UNKNOWN：停止本轮"]
    V["回读已有写入，安全续跑或转人工"]
    Z([结束])

    A --> B --> C --> D
    D -->|是| E
    D -.->|否| U
    E -->|是| F --> G
    G -->|否| H --> K
    G -->|是| I
    I -->|否| J --> E
    I -->|是| K
    K --> L
    L -->|是| M --> N
    L -->|否| N
    N --> E
    E -->|否| O
    O -->|否| P
    O -->|是| Q --> Z
    P --> Z

    F -.->|异常| R
    H -.->|异常| R
    K -.->|异常| R
    M -.->|异常| R
    R -->|确定失败| S --> E
    R -->|无法确认| U
    U --> V --> Z

    classDef stop fill:#FCE8E8,stroke:#CB4C4C,color:#812A2A
    class U,V stop
```

## 关键说明

- **前置条件**：Agent 使用已挂载的 `tfs-sync` Skill，调用 `rondo tfs reconcile-workitem`；同步范围由 Skill 配置决定（当前为指派给 `@me` 的需求和 Bug，单次最多 50 项）。
- **新建**：Issue 以 `backlog + Wayfinder Agent` 初始化；来源信息和附件同步后回读收口，不主动触发 Wayfinder Run。
- **更新 / 跳过**：按 `tfs.id` 匹配；已有 Issue 仅同步 TFS 来源字段、正文及附件，保留业务执行状态和负责人；无变化且无待完成初始化则跳过。
- **异常**：确定性单项失败记录 `failed` 后继续；`UNKNOWN` 停止批次，先核对已写入事实，再决定能否安全续跑。Agent 汇总 `created / updated / skipped / failed` 和待处理项。
- **边界**：Wayfinder 准入、研发交付与 TFS Writeback 不属于本 Agent 流程。

## 实现依据

- [Agent Instructions](./instructions.md)
- [tfs-sync Skill](../../skills/tfs-sync/SKILL.md)
- [同步配置](../../skills/tfs-sync/config/sync-config.json)
- [Rondo 同步实现](../../rondo/src/commands/tfs/reconcile-workitem.ts)
