# Bug Fix Agent 配置资产

Bug Fix Agent 负责当前 Issue 中已授权缺陷的故障诊断、代码修复、开发侧验证和 PR 交付准备。执行边界与交付要求见 [instructions.md](instructions.md)。

## 资产与能力

- [description.md](description.md)：Agent 展示文案。
- [instructions.md](instructions.md)：专业职责、授权边界、验证与交付要求。
- [codebase-explorer](../../skills/codebase-explorer/SKILL.md)：原样复用，只读定位 Repository、实现与影响范围。
- [diagnosing-bugs](../../skills/diagnosing-bugs/SKILL.md)：基于 Matt Pocock 的方法适配，**只在根因不明、证据冲突或复杂故障时按需使用**；Skill 内可在 Agent 既有授权范围直接实施修复。
- `build-fix`：可选构建故障处理方法；暂不注册 Multica Workspace Skill、不强制调用。可用时按需参考 [上游原作者命令](https://github.com/affaan-m/ECC/blob/main/commands/build-fix.md)，否则直接运行项目自身 Build / Test。
- [bug-delivery](../../skills/bug-delivery/SKILL.md)：无 OpenSpec 的 Bug 修复交付 Gate 与 PR Preparation，消费绑定的 Workspace 配置。

当前 **不绑定** `bug-analysis`、`backend-engineering`、`frontend-engineering`，也不因同一 Agent 使用就合并独立方法。外部 Skill 适配来源、差异及 MIT License 见 [diagnosing-bugs](../../skills/diagnosing-bugs/SKILL.md)。

Agent 与 Skill 绑定只由 [provisioning.json](../../workspace-config/provisioning.json) 维护；**不注册为 Delivery Squad Member**，不绑定依赖 `change_ref` / `tasks.md` 的 `development-execution`。

Issue 的入口分流以 [rondo delivery handoff](../../../../tools/rondo/src/commands/delivery/handoff.ts) 为准。

## 部署边界

**合并源文件不代表已经启用或验证线上流程**；只有完整 Rondo 版本部署、Workspace Agent/Skill 发布回读、Repository 就绪且真实 E2E PASS 后，才允许启用生产 Issue 的自动交接。

部署时先验证完整链路，再通过 `rondo workspace provision` / `rondo workspace sync` 发布和回读 Agent / Skill。
