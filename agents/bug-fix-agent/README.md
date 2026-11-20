# Bug Fix Agent

对已授权 Bug 进行诊断、修复、开发侧验证及 PR 交付，不使用 OpenSpec。

角色资产：[Instructions](instructions.md) · [Description](description.md)。

当前 [Manifest](../../workspace-config/provisioning.json) 绑定的 Skills：

- [codebase-explorer](../../skills/codebase-explorer/SKILL.md)：只读工程探索。
- [diagnosing-bugs](../../skills/diagnosing-bugs/SKILL.md)：证据驱动诊断。
- [bug-delivery](../../skills/bug-delivery/SKILL.md)：Bug 修复交付与 PR 准备。
- [workspace-preparation](../../skills/workspace-preparation/SKILL.md)：需要本地代码时准备工作区。

Bug Fix Agent 不属于 Delivery Squad。仓内绑定以 Manifest 为准，远端发布和实际运行结果需分别回读验证。
