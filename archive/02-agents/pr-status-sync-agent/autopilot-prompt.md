执行一次已登记 PR 的状态核实与同步，使用 `pr-status-sync`。
对结果中明确标记为 `finalize` 或 `resume_finalize` 的事项，使用 `finalize-delivery` 依次执行 Prepare、独立 TFS Writeback 和 Complete，只有 TFS 全部成功后才允许 Issue `done`；失败或 `unknown` 事项不得推进，其他结果不追加收口动作。
输出同步结果、已确认动作，以及失败或未知事项的原因。
