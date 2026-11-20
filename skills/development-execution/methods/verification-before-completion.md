# Verification Before Completion（完成前验证纪律）

> **本文件为完成前验证纪律的唯一权威**（语义背景：04 §6.5，根级现行版 `projects/multica/04-engineer-development-design.md`）。本文件是 `development-execution` 的内部 Method，**不是** Independent Verify Agent，不能自行决定 `verify_agent.required`。

## Use When

声明 Local Validation PASS、Task Complete 或 Development Ready **之前**——每次都要。

## Input

- 准备声明的 Claim（PASS / READY / 完成）；
- 当前 Candidate / Contract 的 Evidence Index（`evidence.json`）。

## Procedure：Claim ↔ Evidence 逐条核对

对每条 Claim 回答：

1. 实际执行或有效读取了哪些检查？（命令 / 测试 / 浏览器操作的具体引用）
2. 结果是什么？证据在哪里？
3. 哪些 Claim 仍缺证据？（缺证据的 Claim 不得发布）

随后调用确定性命令 `rondo dev check-completion` 做硬条件核验（exit 0/2/3）；UNKNOWN 不得当放行。

## Output

- 核对结论：每条 Claim 的证据对应关系；缺证据项清单（如有）；
- 核对通过后才允许进入 Task Progress Patch 与 READY 发布。

## Allowed Effects

- 只读核对 Evidence 与 Candidate；触发确定性 Check 脚本。

## Forbidden Effects

- 不补写证据、不改代码、不勾 checkbox；
- 不以"此前某次 Run 通过""Review 很可能没问题"替代当前可复核证据（04 §10.3）；
- 不声称执行了实际未执行的检查。

## Stop

- 任何 Claim 缺有效证据 → 不发布，回到对应环节补齐或按父 Skill Failure 节报告 BLOCKED / UNKNOWN。
