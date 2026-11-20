已定位 Git 传输停滞：控制端相同 MinGit 浅克隆也停在 0 字节 pack；专属进程链的 git-remote-https 实际 TCP 连接为 127.0.0.1:7892 本机代理。真实 TFS API 读取正常。不是 PR status 问题。

两个 Runtime 驱动脚本现在只在自身/子进程 NO_PROXY 中追加 tfs2018-web.winning.com.cn，保留现有其他值；用户已允许此内网 HTTP 验证，不修改全局代理、凭据或 sandbox。认证、浅克隆和 Gate 均保持。

本次浅克隆现已明确超时。请将 M10-clone-preflight.json 备份为 M10-clone-preflight-before-proxy-fix.json。仅对当前 Task 的 `.rondo-finalize-0cDKnZ`，确认源与目标是 workdir 直接子目录且源非链接后，Move-Item -LiteralPath 为 `M10-failed-proxy-clone-0cDKnZ` 保留现场，不删除内容。然后再次运行 runtime-clone-preflight.mjs；PASS 后立即运行 runtime-driver.mjs prepare TEST-13，无须确认。若有新失败，如实报告，不能将 FAIL 改写为 PASS。原始两份失败证据保留。
