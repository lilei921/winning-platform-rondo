# TFS Sync Autopilot v1.3

执行 `tfs-sync` Skill，完成一次 TFS Work Item 同步。

严格按照 `tfs-sync` Skill、当前配置和确定性机制执行。

本次运行同步新建 Delivery Issue：创建与来源字段初始化期间停放 `backlog + Wayfinder Agent`，回读通过后单次激活，**同步完成态为 `todo + Wayfinder Agent`**。不要直接启动 Delivery Squad、Workitem Analyst 或后续研发。

完成后输出简洁的同步汇总；存在失败或冲突时，报告对应 Work Item 和原因。

