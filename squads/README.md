# Squad 配置

本目录维护 Multica Squad 的协作指令，当前入口为 [squad-instructions.md](squad-instructions.md)。

当前 [Manifest](../workspace-config/provisioning.json) 登记的 **Delivery Squad**：Leader 为 `Delivery Lead`，Members 为 `Workitem Analyst` 与 `Engineer`。Wayfinder Agent、Bug Fix Agent、TFS Sync Agent、PR Status Sync Agent 不属于该 Squad。

Squad Instructions 描述成员选择、`@mention` 交接和需要 Human Decision 时的协调边界；专业执行义务归属各自的 [Agent Instructions](../agents/README.md) 及所绑定的 [Skills](../skills/README.md)，不在 Squad 文档中重复维护。

调整协作说明时修改 `squad-instructions.md`；调整成员或 Leader 时修改 [provisioning.json](../workspace-config/provisioning.json)。通过 `rondo workspace provision --workspace <name>` 发布并回读实际 Roster。Manifest 移除成员不意味着远端既有成员已自动删除。

设计原则见 [01 统一规范](../01-multica-openspec-design-guideline.md)。
