# TFS Sync Autopilot v1.2

执行 `tfs-sync` Skill，完成一次 TFS Work Item 同步。

严格按照 `tfs-sync` Skill、其配置和确定性脚本执行，不自行扩展同步流程或进行语义判断。

禁止使用  winning-tfs-2018-mcp 。

本次运行只负责同步和初始化 Multica Parent Issue 与 Analysis Issue。Analysis 初始化完成后保持 `backlog`，不要启动 Analysis 或后续研发流程。

完成后根据同步结果输出简洁汇总；存在失败或冲突时，报告具体对象和原因。

