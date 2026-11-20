# M02 MSYS / MXC 定位与兼容工具调用

日期：2026-11-13。初次失败与修复后真实 Runtime 结果分开保留，最终验收见 [M02](M02.md)。

## 已确认的原因

1. 当前 Task 有效配置为 `workspace-write / approval_policy=never / windows.sandbox=mxc`。Git for Windows 2.54.0 的 `sh.exe -c 'exit 0'` 单独启动即报 `NtCreateDirectoryObject(\BaseNamedObjects\msys-2.0S5-3b42950b65a27490): 0xC0000022`，退出状态 `0xC0000142`。这与仓库认证、origin、子仓目录无关。
2. 本机隔离 seed 的 `git clone --local --no-hardlinks` trace 显示 Git 调用 MSYS sh 执行 git-upload-pack，shell 初始化即失败；protocol v0 同样失败。[原 Git trace](M02-original-git-clone-trace.txt)。
3. 上游 [microsoft/mxc #1061](https://github.com/microsoft/mxc/issues/1061) 描述了同类 MSYS 绝对 NT 对象命名空间与 AppContainer 的兼容问题。这里只据本轮复现判定当前组合，不宣称所有 Windows/Git 版本都有相同故障。
4. 官方支持的 elevated 沙箱对照命令被本机 `.sandbox-bin` provisioning lock 访问失败阻断。未改变持久配置或 ACL；没有自动审批拒绝。本轮选择兼容 Git 工具，不切换沙箱。

## 工具包与调用边界

- 官方 [Git for Windows MinGit](https://gitforwindows.org/mingit.html) 提供 BusyBox 变体；BusyBox shell 是 Win32 程序。该变体仍被官方标为 experimental，不代表完整 Bash/Perl/hooks 兼容。
- 固定使用与原 Git 相同版本的 [2.54.0 Windows 发布](https://github.com/git-for-windows/git/releases/tag/v2.54.0.windows.1)：`MinGit-2.54.0-busybox-64-bit.zip`，35,366,840 bytes；下载 SHA256 与 GitHub release asset digest 同为 `1a90b2cc07f0d2c155d68dc9fe4193088f98a022ce37f93dec1212846b402692`。
- 解压前检查每个 ZIP entry 解析后仍位于目标目录。安装到 `C:\Users\lilei\.multica\tools\mingit-busybox-2.54.0`，保留原 Git、全局 PATH 和沙箱配置。
- 包内仍含部分 MSYS 辅助文件（例如 SSH），不能声称整个发行包不含 MSYS。本轮验证仅要求 Git 的本地传输 shell 不加载 MSYS。
- 只前置 cmd 不足：会继续找到原安装的 sh；移除旧 Git PATH 后，原包装 fallback 调用 busybox.exe -c 又报 applet not found。最后在便携 `mingw64/bin` 增加包内 busybox.exe 的同字节副本 `sh.exe`，两者 SHA256 均为 `ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32`。同沙箱普通 clone 随后成功，seed/clone SHA=`a44ff5f86ed472c3ac6815b7bacb2520bf4ee7c9`。[成功 trace](M02-busybox-probe-trace.txt)。

## 真实 Runtime 的配置发现

测试 Agent 的 custom_env.PATH 写入成功但运行时无效。当前部署 Multica `b1ea927def6490c43bedff537b6f4ed9a47fa828` 的 [daemon.go](https://github.com/multica-ai/multica/blob/b1ea927def6490c43bedff537b6f4ed9a47fa828/server/internal/daemon/daemon.go) `isBlockedEnvKey` 明确屏蔽 PATH；不能把“配置已保存”当作“子进程已采用”。TEST-7 首次 preflight 正确停在工具身份门禁，未执行 clone。

已将测试 Agent custom_env 恢复为 `{}`。最终采用**显式便携 git.exe + Git 子进程局部 PATH**：只给该 Git 及其子进程优先选择便携 cmd/mingw64/bin。原生 `multica repo checkout` 使用原 Task CLI 与 Task 身份。未修改/伪造 MULTICA 变量、Daemon、Agent 指令、全局 PATH、ACL 或沙箱策略。

工具包安装属于控制端供给；seed、bare、child 的实际创建与 clone 必须由真实 Runtime 自主执行。真实结果与证据在 [M02 报告](M02.md) 中登记。默认 MSYS Git 的问题仍存在；后续 Rondo 适配应明确选用已验证的 Git 工具组合，不能仅依赖 Agent custom_env.PATH。

## 撤回方式与限制

测试 Agent 环境已撤回，无需重启 Daemon。便携工具目录暂保留供复验；要停止使用，只需不在 Git 子进程显式选用该目录。此兼容方案只证明已执行的 Git 行为，不证明 SSH、任意 Bash hooks、完整 Rondo dev prepare 或生产凭据边界通过。
