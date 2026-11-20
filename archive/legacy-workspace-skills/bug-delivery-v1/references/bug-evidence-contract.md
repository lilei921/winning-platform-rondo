# Bug 修复证据契约（无 OpenSpec）

`rondo bug prepare-pr` 读取本地 JSON，只将必要摘要与可核查引用持久化在 Multica `bug.delivery`；原始日志、敏感数据不复制进 Metadata。下例的字段值仅为格式示例，并非真实验证结果。

```json
{
  "issue": "MUL-123",
  "tfs_id": 123,
  "repo_key": "frame-web",
  "candidate_commit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "expected_behavior": "正常返回列表",
  "actual_behavior": "请求在空数据条件下失败",
  "root_cause": {
    "confidence": "confirmed",
    "summary": "代码未处理空数据",
    "evidence_refs": ["test:NullListCase"]
  },
  "fix_summary": "补充边界判断",
  "regression": {
    "result": "PASS",
    "summary": "故障回归用例通过",
    "evidence_refs": ["ci:regression-123"]
  },
  "local_validation": {
    "result": "PASS",
    "summary": "编译及受影响单元测试通过",
    "evidence_refs": ["ci:unit-123"]
  },
  "code_review": {
    "result": "PASS",
    "summary": "Review 通过",
    "evidence_refs": ["review:123"],
    "findings": []
  },
  "blockers": []
}
```

- `issue`、`tfs_id`、`repo_key`、`candidate_commit` 必须与当前 Issue 和远端候选 Commit 一致。
- `root_cause.confidence` 仅允许 `confirmed` / `probable`；`probable` 另需非空 `remaining_risk`，关键替代根因仍可能改变修复时不得放行。
- `regression`、`local_validation`、`code_review` 均必须有真实 PASS、简要结论与可访问的 Evidence References；不能用计划执行的命令代替执行结果。
- `code_review.findings` 不得存在未解决 Blocking Finding；未解决 Non-blocking Finding 必须标记 `blocking:false` 并提供 `risk_note` 或 `risk_ref`。
- `blockers` 必须为空数组；若不能复现可用可信替代验证，但必须解释限制与有效覆盖。
- `bug.delivery` 是本次已验证的仓级交付事实；同一 Issue 多仓时逐仓维护，不能把某仓 PASS 当作整个 Issue 完成。
