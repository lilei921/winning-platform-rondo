# multica CLI 缺陷报告：传输层失败以空 stdout + 成功退出码混出

> 状态：草稿，待提交上游（multica 厂商）
> 整理日期：2026-11-02
> 影响版本：multica 0.7.0（commit dbdbb2991，go1.27.3，windows/amd64）
> 关联：`projects/multica/analyst-run-efficiency-optimization-plan.md` §2 归因 1；证据归档 `projects/multica/logs/WNDF-43/`

## 现象

multica server 无响应期间，CLI 读命令（`issue get` 等）表现为：

- stderr 打印 `Request timed out: the server did not respond in time. Check your network connection or try again later. You can raise the limit with MULTICA_HTTP_TIMEOUT.`
- **stdout 完全为空**
- **退出码为 0（或 2）**——成功类退出码

## 期望行为

1. 传输层失败（超时 / 连接错误 / 5xx）以**非 0、非 2 退出码**退出，失败语义可机器识别；
2. 读操作内建超时重试（如指数退避 ≤2 次），或提供 `MULTICA_HTTP_RETRY` 配置；
3. `MULTICA_HTTP_TIMEOUT` 的默认值与语义文档化。

## 影响

下游以「exit 0/2 → 解析 stdout JSON」为契约（合法空结果为 `[]` / `{}`，stdout 绝不为空）。当前行为使传输失败被伪装成"成功的空结果"，下游 `JSON.parse("")` 抛 `Unexpected end of JSON input`，故障被误报为数据/格式问题，排障方向被误导。

实测案例（2026-10-29 07:00–07:03 UTC，WNDF-43 分析 Run）：

- Gate 校验内部 `multica issue get WNDF-43 --output json` 两次返回空 stdout，结果文件记录：`"读取 Issue(WNDF-43) 输出不是合法 JSON: SyntaxError: Unexpected end of JSON input"`；
- 同期直接复现：`multica issue get WNDF-43 --output json | head -c 300` → stderr 输出上述 timeout 文案，stdout 空；
- `sleep 15` 后同命令恢复正常（确认为瞬时窗口）。

## 环境

- CLI：multica 0.7.0（windows/amd64），server：自建实例（172.17.1.97:8080）
- 复现窗口：server 无响应期间任意读命令

## 临时规避（下游已实施）

skill-flow spawn 层对「exit 0/2 且 stdout 全空白」判定为瞬态故障并重试一次（`tools/skill-flow/src/clients/spawn.ts` runJson `transient` 选项）。上游修复后该层保留作纵深防御。
