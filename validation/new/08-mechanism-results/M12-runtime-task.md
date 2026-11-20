# M12 可选 MCP 降级机制验证

这是用户授权的无 Project 测试 Run，运行在 Codex (lileipc)。不要 checkout 本地业务仓，不修改远程 MCP、索引、凭据或服务配置。

控制端已从现有 Filesystem MCP 只读下载 CodeGraph 索引，SQLite quick_check=ok，476 个索引文件 Hash 全部匹配 frame Commit dc6ff47ff2f4e8f24c0db4c3efe88dcf92c5bf7a；证据在 M12-index-commit-audit.json。并未重建索引。

在当前 Task 工作目录执行 `python D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/m12-runtime-fallback.py`。脚本正常场景真实调用现有 CodeGraph MCP；不可用/旧索引仅在测试进程注入故障，每个场景自动继续真实固定 SHA TFS API 读取，不更改服务。脚本使用现有 MCP 配置的认证入口，严禁打印配置/凭据。

记录 Runtime/Run ID、脚本退出码、M12-runtime-fallback-evidence.json 完整路径和 Hash。结论必须标为真实 Runtime 内的隔离机制 PoC，不把此脚本称为已实现的生产自动降级编排。若脚本失败，保留实际输出，不降低 sandbox 或权限。不要创建其他 Agent。
