# Bug 修复证据契约（无 OpenSpec）

`rondo bug prepare-pr` 消费以下 JSON，校验后将仓级交付事实持久化至 `bug.delivery`。只记录必要结论与可核查引用，不复制完整日志、Trace、测试输出或敏感数据。

示例值仅说明格式，不代表实际验证结果：

```json
{
  "expected_behavior": "正常返回列表",
  "actual_behavior": "空数据时请求失败",
  "root_cause": {
    "confidence": "confirmed",
    "summary": "代码未处理空数据",
    "evidence_refs": ["test:NullListCase"]
  },
  "fix_summary": "增加空数据边界处理",
  "regression": {
    "result": "PASS",
    "summary": "故障回归用例通过",
    "evidence_refs": ["test:NullListCase"]
  },
  "local_validation": {
    "result": "PASS",
    "summary": "定向编译及相关测试通过",
    "evidence_refs": ["test:TargetedSuite"]
  },
  "code_review": {
    "result": "PASS",
    "summary": "修复范围已审查",
    "evidence_refs": ["review:CandidateCommit"],
    "findings": []
  },
  "blockers": []
}
```

## 字段规则

- `issue`、`tfs_id`、`repo_key`、`candidate_commit` 可省略，由 Rondo 从当前 Issue、参数与真实 Git 事实核验；显式提供时必须匹配。
- `expected_behavior`、`actual_behavior`、`fix_summary` 必须反映当前 Bug。`root_cause.confidence` 为 `confirmed` / `probable`；`probable` 必须有非空 `remaining_risk`，可能推翻修复的关键替代根因不得放行。
- Root Cause、Regression、Local Validation、Code Review 的 `evidence_refs` 必须指向已存在且可核查的源码、测试结果、Run 命令记录或 Review；不得伪造引用。
- `regression`、`local_validation`、`code_review` 必须有实际 `PASS` 和简短结论；未执行的验证不得报 PASS，替代验证必须说明限制。
- `code_review.findings` 不得有未解决 Blocking Finding；未解决 Non-blocking Finding 必须用 `blocking:false` 及 `risk_note` / `risk_ref` 标注。`blockers` 必须显式为空数组。
- 多仓分别记录验证事实，不得用某仓 PASS 代替整个 Issue 完成。
