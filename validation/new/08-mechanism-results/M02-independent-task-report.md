M02 独立 Run 验证：PASS

Issue：TEST-8；Task：01a1d329-8ec9-7ec7-9431-909e55251162。
断言通过 28/28；Rondo dev prepare：NOT_RUN。

| 阶段 | 结果 |
| --- | --- |
| preflight | PASS |
| checkout1 | PASS |
| registry | PASS |
| checkout2 | PASS |
| fixture | PASS |

沙箱：`workspace-write / never / mxc`。MULTICA_TOKEN 和 MULTICA_DAEMON_PORT 仅记录存在性，不记录值。

Daemon/Runtime：
```json
{
  "daemon": {
    "daemon_id": "01a01965-2f6a-72fe-899f-3e7556c5d51d",
    "pid": 32136,
    "device_name": "lileipc",
    "status": "running",
    "cli_version": "0.8.1",
    "cli_commit": "b1ea927def6490c43bedff537b6f4ed9a47fa828",
    "os": "windows",
    "active_task_count": 1,
    "running_task_count": 1
  },
  "runtime": {
    "id": "c55feddd-7910-480a-8f9f-9d6180b1f061",
    "name": "Codex (lileipc)",
    "provider": "codex",
    "status": "online",
    "daemon_id": "01a01965-2f6a-72fe-899f-3e7556c5d51d"
  }
}
```

根仓初次身份：
```json
{
  "path": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\winning-platform-monorepo",
  "dot_git_is_directory": true,
  "dot_git_is_file": false,
  "head": "dfdaf33fa58355332259524266045d1052ef9dea",
  "branch": "agent/m01-checkout/909e55251162",
  "top_level": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo",
  "git_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "common_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "origin": "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo",
  "status": ""
}
```

根仓重复 checkout 身份：
```json
{
  "path": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\winning-platform-monorepo",
  "dot_git_is_directory": true,
  "dot_git_is_file": false,
  "head": "dfdaf33fa58355332259524266045d1052ef9dea",
  "branch": "agent/m01-checkout/909e55251162",
  "top_level": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo",
  "git_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "common_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "origin": "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo",
  "status": ""
}
```

根仓最终身份：
```json
{
  "path": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\winning-platform-monorepo",
  "dot_git_is_directory": true,
  "dot_git_is_file": false,
  "head": "dfdaf33fa58355332259524266045d1052ef9dea",
  "branch": "agent/m01-checkout/909e55251162",
  "top_level": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo",
  "git_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "common_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/.git",
  "origin": "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo",
  "status": ""
}
```

Registry：
```json
{
  "source": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\winning-platform-monorepo\\docs\\config\\repo-context.yaml",
  "source_sha256": "03659b983297ad67bda435390d3b3e3b207dc33a7af6d8189dd0fb232afaa008",
  "common.repo_path": "winning-dps-df-common",
  "common.repo_url": "http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/WiNEX%20DataFactory/_git/winning-dps-df-common"
}
```

本地 fixture：
```json
{
  "directory": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\validation-fixture",
  "seed": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\validation-fixture\\seed",
  "bare": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\validation-fixture\\common-fixture.git",
  "seed_head": "8f20fe14e5ed713c36e4539d33770f69a0a502bf",
  "bare_head": "8f20fe14e5ed713c36e4539d33770f69a0a502bf",
  "is_bare": "true"
}
```

子仓身份：
```json
{
  "path": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\winning-platform-monorepo\\winning-dps-df-common",
  "dot_git_is_directory": true,
  "dot_git_is_file": false,
  "head": "8f20fe14e5ed713c36e4539d33770f69a0a502bf",
  "branch": "fixture-main",
  "top_level": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/winning-dps-df-common",
  "git_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/winning-dps-df-common/.git",
  "common_dir": "C:/Users/lilei/multica_workspaces/rondo-test-8ef6a0bcf15d/test-8-909e55251162/workdir/winning-platform-monorepo/winning-dps-df-common/.git",
  "origin": "C:\\Users\\lilei\\multica_workspaces\\rondo-test-8ef6a0bcf15d\\test-8-909e55251162\\workdir\\validation-fixture\\common-fixture.git",
  "status": ""
}
```

New Run did not automatically migrate the previous Run child: child absent after first and repeated native checkout in TEST-8. TEST-7 was not inspected.

Ignore 命中：`.gitignore:8:/winning-dps-df-*/	winning-dps-df-common/M02-local-validation.txt`。

PowerShell `.ps1` 记录器启动失败：exit 1，PSSecurityException / AuthorizationManager。失败发生于脚本体执行前；之后使用 Python 记录器调用 CLI/Git，未调整执行策略或沙箱。

两个本地 clone 的 GIT_TRACE 均记录便携 `mingw64/bin/sh.exe -c` 启动本地 `git-upload-pack`，退出码为 0。探索阶段另有路径不存在和 rg 无匹配，均为只读命令，已单列诊断记录。

所有验证命令的时间、cwd、argv、exit、脱敏 stdout/stderr 和 assertions 见 `M02-independent-evidence.json`；本地 clone trace 另见 `local-clone-trace.log`。启动失败的工具响应仅提供耗时，绝对时间未伪造。

现场保留；未读取或修改 TEST-7，跨 Task before/after 由控制端单独比较。仅原生根仓 checkout/fetch 使用获授权根仓 URL；未访问 registry 指向的真实业务子仓 origin，未 push，根仓未创建 commit。Issue 元数据保持原样。
