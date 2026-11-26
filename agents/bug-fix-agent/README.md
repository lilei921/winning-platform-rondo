# Bug Fix Agent

对已授权 Bug 进行诊断、修复、开发侧验证及 PR 交付，不使用 OpenSpec。

角色资产：[Instructions](instructions.md) · [Description](description.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 绑定的 Skills：

- [codebase-explorer](../../skills/codebase-explorer/SKILL.md)：只读工程探索。
- [diagnosing-bugs](../../skills/diagnosing-bugs/SKILL.md)：证据驱动诊断。
- [pull-request](../../skills/pull-request/SKILL.md)：Candidate 发布与 PR 准备、提交。
- [native-workspace](../../skills/native-workspace/SKILL.md)：需要本地代码时准备工作区。

Bug Fix Agent 不属于 Delivery Squad。仓内绑定以 Manifest 为准，远端发布和实际运行结果需分别回读验证。
