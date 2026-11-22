# 远端 OpenSpec 收口工件

无 Project Runtime 可通过显式配置启用远端读取；独立 Bug 流程无需此配置。

```json
{
  "runtime": {
    "workspace_id": "<workspace UUID>",
    "root_branch": "<固定权威分支短名称>"
  },
  "registry": {
    "frame": {
      "repo_path": "winning-dps-df-frame",
      "repo_url": "http://<tfs>/<collection>/<project>/_git/winning-dps-df-frame",
      "tfs_repo": "winning-dps-df-frame",
      "tfs_project": "<project>"
    }
  }
}
```

根仓身份来自 `analysis.source.repo_url`。每次命令仅解析一次 `root_branch` 的完整 SHA，随后以 Git Items API 固定 SHA 读取当前或归档 Change，并与 `analysis.source.commit` 的批准正文逐文件核对。任务勾选变化允许；正文、文件集合、Schema 漂移以及多个归档同名均拒绝。API 失败不回退其他版本或旧目录。

远端 Evidence 的 `commits[]` 使用 `repo_key`、与 registry 一致的 `repo_url`、完整 40 位 `sha`。旧 `repo_path` 可以保留作诊断，但不用于跨 Runtime 寻址。PR 必须真实 completed，合并 Source Commit 必须等于 `pr_prep` 候选。不要仅凭 PR 的合并预览状态放行。

Prepare 下载只读工件缓存；尚未归档时在当前 Task 目录创建独有临时根仓，真实 clone 固定分支、检查快照未前进，再执行现有 OpenSpec Archive、限定范围提交与推送。独立 API 回读归档后才登记 prepared。推送已确认的临时根仓会删除；无法确认或尚未发布的 clone 保留诊断，禁止盲删。

临时 clone/fetch/push 复用已有 TFS 配置的凭据，只经 Git 子进程环境传入精确仓库 URL 的认证头；不依赖 Windows Credential Manager，不把凭据写入 argv、日志或仓库配置。此调用禁止 HTTP 重定向，并关闭继承的 Git 网络 Trace。Git 可执行文件仍由 Runtime 的进程环境选择；Windows MSYS 不兼容的 Runtime 使用已验证的 BusyBox MinGit，不能关闭沙箱作为替代。

临时根仓使用单分支、无 tag 的浅克隆；仅首次 clone 的超时为 20 分钟，其他命令仍为 5 分钟。批准基线历史不依赖浅仓：仍通过固定 Commit API 读取。内网如需直连，按已批准网络策略在 Runtime 子进程 `NO_PROXY` 登记 TFS 主机，不修改全局代理。

后续 Prepare 重试、独立 TFS Writeback、Complete 仅下载本次 Change 的 API 工件缓存，不需要原工程师或 Prepare 的目录。Writeback 再核对批准、证据、当前 PR 和 pending 身份；Complete 回读 TFS 父子项实际状态后才发布摘要并置 done。工件缓存结束即清理。不同 Runtime 可以顺序接续，但这不是多写者并发调度协议。

未配置 `runtime.root_branch` 时，必须显式传入 `--root-repo <实际根仓路径>` 使用本地检出；已配置时传入该参数也会选择本地模式。不要以本地覆盖掩盖远端证据缺失。
