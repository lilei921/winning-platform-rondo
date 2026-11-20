# M12 — 可选 MCP 版本一致性

- 日期：2026-11-13；总体状态：**NOT_RUN / PARTIAL_EVIDENCE**（不作为主流程阻塞）。源码片段一致性 **PASS**。
- 远程 Filesystem 允许目录 `/root/winning-platform-monorepo`；frame 镜像 `.git/HEAD` 指向 dev，ref=`dc6ff47ff2f4e8f24c0db4c3efe88dcf92c5bf7a`。CodeGraph 已有索引，历史 daemon 日志版本 1.6.2；未主动创建索引。

实际查询 `PermissionPlatService getPermissions`，[CodeGraph 原始返回](M12-codegraph-response.txt)。从 TFS API 4.1 按上述固定 SHA 读取同文件，对返回的 111–124 行逐行比较一致；两侧片段 SHA256=`5bebc3536f602f2aed5d539ef67fe34423aecac8fe14947d6385d1956293bfcd`。[比对脚本](m12-source-comparison.mjs)、[比对证据](M12-source-comparison.json)。独立 TFS GET 不依赖 MCP 查询结果即可完成。

限制：工具未提供索引构建 Commit；数据库时间戳、镜像 HEAD 和一段源码一致均不能证明整个调用图对应此 Commit。此时索引关系只能作为线索，事实仍以固定 SHA API 回读为准。未向真实 Runtime 注入 MCP 断网/索引过期故障，自动降级编排 NOT_RUN；没有把手动独立 API 读取声称为端到端自动恢复。

结论：可选 MCP 单文件源码证据可与固定 SHA 对照；全图来源与自动降级证据不足时，继续主 TFS API 路径并准确标未知，不扩大主流程依赖。
