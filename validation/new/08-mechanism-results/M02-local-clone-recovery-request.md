# M02 本地 fixture 的执行环境恢复

用户要求 M01/M02 连续验证；M01 已通过，不重复运行。控制端已读取本轮具体失败：本地 bare clone 启动 MSYS sh 时 NtCreateDirectoryObject 返回 0xC0000022。此记录必须保留，它不是二级 Git 目录规则失败或 TFS 认证失败。

继续本 Task 的 M02，不修改产品或平台配置。先确认 seed 仍完整、bare 和 child 目标未生成；保留已有初始 Commit，不重做、不删除现场。

本轮允许使用工具原生的 sandbox_permissions=require_escalated（若可用）执行以下原计划本地操作：读取本 Task validation-fixture/seed，将其 clone --bare 到本 Task validation-fixture/M02-local-fixture.git，再 clone 到本 Task root/winning-dps-df-common。仅此当前隔离 Task 目录写入，不访问远端，不改全局配置。每次路径必须先解析并确认在当前 Task workdir 内。可使用 --local --no-hardlinks 和正斜杠绝对路径明确本地复制语义；不使用 file:// 或远程传输绕过。

如果工具不支持提权或自动审批拒绝，保存具体阻碍并说明，控制端将使用同一受控测试路径提供外部 fixture 准备。不要循环尝试权限绕过。恢复成功后按原 M02 步骤继续：双仓身份、root 忽略、child 脏修改、普通 root checkout 重入保留、保留供 Run B 核验的现场。

仍禁止 root clone、fresh/reset/clean、cache 修改、Daemon 重启、Git Push/PR/TFS 写入。不要修改之前的失败记录；最终明确本地 clone 是否需要沙箱外权限。
