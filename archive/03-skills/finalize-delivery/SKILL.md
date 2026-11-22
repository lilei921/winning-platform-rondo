---
name: finalize-delivery
description: 在已登记 PR 全部 completed 后核验工程交付条件，完成 TFS 回写与 Issue 收口；支持 OpenSpec 和独立 Bug 交付。
---

# Finalize Delivery

## 输入

- 目标 Issue、已登记的 PR 与工程交付事实。
- 可访问 Multica / TFS 的 `rondo`，以及本 Skill 目录下 `config/repo-registry.json` 的绝对路径。
- 独立 Bug 不需要根仓或 Archive。OpenSpec 需要可核验的 Change；使用远端工件时按本技能的[配置说明](references/remote-artifacts.md)准备；使用本地检出时取得实际根仓路径，并在下面三个命令中均追加 `--root-repo "<实际根仓路径>"`。

## 执行

依次执行，每一步成功后才进入下一步：

```bash
rondo delivery finalize --phase prepare --issue <KEY> --config "<config-path>"
rondo tfs writeback --issue <KEY> --config "<config-path>"
rondo delivery finalize --phase complete --issue <KEY> --config "<config-path>"
```

1. **Prepare**：命令核验实际 PR 终态、候选版本及工程证据，并处理适用的归档。取得 exit 0、`result=PASS` 后，`status=prepared` 才进入 Writeback；`already=done` 则本次结束，不再回写 TFS。
2. **Writeback**：必须取得 exit 0、`result=PASS` 才能继续。
3. **Complete**：必须取得 exit 0、`result=PASS`、`status=done`，且 pending 已清理，才报告完成。`already=done` 表示已确认完成；独立 Bug 的 `route_archive=skipped` 是合法结果。

中断恢复仍使用同一 Issue 按此顺序执行，由命令核对已有副作用并补齐缺失动作；不手工补写标记、重发评论或重新制作工程证据。

## 失败处理

- `FAIL`（exit 2）：停止，处理返回的前置条件缺口。
- `UNKNOWN`（exit 3）：停止，核对不确定的事实或写入结果，不盲目重试。
- 不回滚已确认的副作用，不以中间步骤成功宣称交付完成。

## 输出

返回本次收口结果和工具提供的摘要引用；未完成时说明停止步骤及原因。
