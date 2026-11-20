初次 preflight：FAIL，后续 checkout/clone 未运行。

默认 git/sh 均解析到 D:\UserApp\Git\bin；未选中指定便携工具。实际 git 为 2.54.0.windows.1；sh --version 退出 3221225794（0xC0000142），stderr 包含 MSYS NtCreateDirectoryObject 权限错误 0xC0000022。

指定 sh.exe 与 busybox.exe 已存在且 SHA256 均为 ab90c8f11cb814b8915f07d4ad2a0b910f5ba82a8aec9a575eb393c0ec29cc32。这不是工具包安装失败。控制端补充说明 custom_env.PATH 被 daemon 的 isBlockedEnvKey 忽略；本 Runtime 未自行核验该控制端代码。

有效配置：workspace-write / never / mxc。未执行 checkout、clone、commit，未创建 fixture。

原始 JSON 已逐字节保留为 M02-autonomous-preflight-evidence.json；SHA256：3d6d63441325b269a855825c4e49df80c461a18e94f9d0931a4ac06fb46827a9。
后续依据用户修正采用显式兼容 Git 子进程调用，另记 M02-autonomous-evidence.json。
