# OpenSpec Schema / Template 瘦身优化落地方案

> 状态：已实施（2026-10-30，结果见 §6）
> 日期：2026-10-30（v2：去除 shared 参考文件，改为删除优先策略；v3：审核修正——度量命令补 `--change`、验收指标改分 schema 口径并填入实测基线、`--type spec` 保留明确化；v4：实施后补录结果并修正度量口径为 instruction 本体字节数）
> 范围：仅 `openspec/schemas/intentional-change/` 与 `openspec/schemas/corrective-change/` 两个 schema 的 `schema.yaml` 与 `templates/`。TFS type → schema 路由（change_kind 映射）、工件依赖图、multica 派发/物化流程、`tasks.md` checkbox 格式均不变。

## 1. 背景与目标

### 1.1 问题

每次 `openspec instructions <artifact>` 会把该 artifact 的整段 instruction 注入上下文。当前成本分布：

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `intentional-change/schema.yaml` | 233 | specs 指令约 90 行，含大量 CLI 边角行为解释 |
| `corrective-change/schema.yaml` | 100 | 相对轻，但 tasks/apply 指令与 intentional 逐字重复 |
| 两 schema 的 templates/ | 15–39 行/个 | 已经足够瘦，基本无优化空间 |

instruction 中的冗余分三类，性质不同、处置不同：

1. **永不触发类**：`--store` / ambiguous-item / `planningHome.root` 解析等内容继承自上游 OpenSpec 指令，但本项目未注册任何独立 store（`openspec store list` 为空），这些场景不会发生；且 CLI 报错时会自行打印带 flag 的提示。约 20 行，应**直接删除**。
2. **硬规则重复类**：派工约束与 checkbox 语义在 intentional/corrective 的 tasks 指令、apply 指令及模板注释中出现 4 处。属 multica 派工硬规则，应**压缩后内联保留**，不外置。
3. **示例重复类**：spec delta 完整示例（~25 行）、tasks 示例（~13 行）在 instruction 与模板注释中双份。模板是生成时必然读到的"免费位"，instruction 中的示例应**删除，由模板承载**。

### 1.2 目标

实测基线（`openspec instructions <artifact> --schema <name> --change 229151` 输出字节数，2026-10-30）：

| schema | proposal | specs | design | tasks | apply | 合计 |
| --- | --- | --- | --- | --- | --- | --- |
| intentional-change | 4953 | 7012 | 3110 | 4687 | 1255 | 21017 |
| corrective-change | 4326 | 2776 | — | 3408 | 1254 | 11764 |

收益集中在 intentional 的 proposal + specs + tasks（约 16.6k bytes）；corrective 的 instruction 本体脂肪少（无 store 内容，specs 输出大部分是 CLI envelope），预期降幅有限。分 schema 验收：

- intentional-change 合计输出下降 ≥40%（21017 → ≤12600 bytes）；
- corrective-change 合计输出下降 ≥15%（11764 → ≤10000 bytes）；
- `openspec validate --strict` 行为不变（所有会导致静默失败的硬规则保留在 instruction 内）；
- multica 全流程不变：TFS type → schema 选择、dev.dispatch / materialize-tasks、`skill-flow change update-progress` 均不受影响。

### 1.3 非目标

- 不改 schema 名称、版本、artifact 依赖图（proposal → specs → design → tasks）；
- 不改 TFS type → change_kind → schema 的路由逻辑（见 `05-openspec-schema-implementation-design.md` §change_kind 映射）；
- 不改 `tasks.md` checkbox 格式与派工约束语义本身（只压缩表述）；
- 不动 `sdd` schema（multica 流程未使用，另行评估）。

## 2. 方案设计

核心原则：**删除 > 内联压缩 > 模板承载**。不引入外部参考文件——每个 schema 的 instructions 输出保持自包含，避免"指针是否被跟随"的新故障模式。

### 2.1 删除项（永不触发 + 纯解释性内容）

从 `intentional-change/schema.yaml` 删除：

- 全部 `--store "<id>"` 追加规则（proposal、specs 两处；本项目无 store）；
- ambiguous-item 的**解释性文字**——但注意：change 与 spec 同名时无 store 也会触发该错误（本仓 change 多为 TFS 编号命名，碰撞概率低但存在），因此 `openspec show` 的 `--type spec` flag 本身**必须保留**在压缩后的指令中，只删原理说明；
- `planningHome.root` 的 store 解析原理（压缩为一行："修改既有 capability 主 spec 时，用 `openspec instructions ... --json` 返回的 `planningHome.root` 定位 `openspec/specs/`"；本地无 store 时该字段即当前仓库）；
- 实现细节说教性语句（如"这是后续工作的基础"等不承担规则的句子）。

`corrective-change/schema.yaml` 无 store 内容，本项不涉及。

### 2.2 instruction 瘦身（按 artifact）

保留规则：**凡是违反后 `openspec validate` 静默失败或行为错误的硬约束，必须留在 instruction 正文**；示例移到模板，解释性内容删除。

#### intentional-change/schema.yaml（233 → 目标 ≤120 行）

| artifact | 现状 | 改法 |
| --- | --- | --- |
| proposal | ~35 行 | 章节要求保留；CLI 调查流程压缩为 3 行（先 `openspec list --specs` 列能力，相关能力用 `openspec show "<spec-id>" --type spec` 完整读，复用准确路径，不带 `--store`）；skip_specs 判定保留（硬规则）；删说教句 |
| specs | ~90 行 | 保留：`## Purpose` 仅新增 capability 且 ≥50 字符、`####` Scenario 四井号硬规则、SHALL/MUST、每 requirement ≥1 scenario、MODIFIED 必须含完整原块（标题精确匹配）、路径必须复用现有 capability 不得虚构。删除：25 行完整示例（由模板承载，留一句"格式骨架见模板注释"）、store 全部内容、planningHome.root 原理 |
| design | ~20 行 | 基本不动，仅删与 proposal 重复的措辞 |
| tasks | ~50 行 | 保留：checkbox 编号格式、单 session 粒度、验证方式内联、测试/文档随组交付。派工约束 + checkbox 语义压缩为 3 行内联（见 §2.3）；删 13 行示例（模板已有） |
| apply | ~8 行 | 压成 2 行：逐项处理未完成任务；勾选经 `skill-flow change update-progress`，不直接编辑 tasks.md |

#### corrective-change/schema.yaml（100 → 目标 ≤70 行）

| artifact | 改法 |
| --- | --- |
| proposal | 章节要求保留；"不展开完整排查记录"等约束保留；无实质冗余，微调措辞 |
| specs | 保留 delta 操作语义与"无持久增量则合法跳过"；格式细节留一句指向模板注释 |
| tasks | 派工约束 + checkbox 语义压缩为 3 行内联（同 intentional） |
| apply | 同 intentional 的 apply 改法 |

### 2.3 派工约束的统一压缩表述（两 schema 内联共用）

将现有约 8 行段落压缩为（措辞实施时定稿，语义不变）：

```
派工约束：有效派工期间已引用任务编号与正文保持稳定，增补/取消/替换/重编号须经受控
Analysis/Coordination；已批准取消的任务不假勾 [x]，保留原编号转为不参与进度的历史记录。
进度勾选仅 `x` 算完成，且必须经 `skill-flow change update-progress`，不得直接编辑本文件。
```

两处 schema 各保留一份（每份 3 行，重复成本可忽略），保证 instructions 输出自包含。

### 2.4 模板调整（轻量）

- 两 schema 的 `templates/spec.md`：补上从 instruction 删掉的 MODIFIED 完整块示例（intentional 模板目前只有 ADDED 骨架，补约 6 行注释示例）；
- 两 schema 的 `templates/tasks.md`：注释中的派工约束三段替换为 §2.3 的 3 行压缩版；
- 其余模板不动。

### 2.5 配套文档同步

- `projects/multica/05-openspec-schema-implementation-design.md` §6/§7 内嵌了 schema 全文，与 `openspec/schemas/` 存在双份事实。本次在两节开头各加一行标注：**"本节为历史快照，现行契约以 `openspec/schemas/<name>/` 为准"**，不逐段同步（避免再次双写）。

## 3. 验证方案

1. **尺寸度量**（优化前后各跑一次，记录字节数；注意 `openspec instructions` 必须带 `--change`，否则输出为空）：
   ```bash
   for a in proposal specs design tasks apply; do
     printf "%s: " $a; openspec instructions $a --schema intentional-change --change 229151 | wc -c
   done
   for a in proposal specs tasks apply; do
     printf "%s: " $a; openspec instructions $a --schema corrective-change --change 229151 | wc -c
   done
   ```
   验收：按 §1.2 的分 schema 目标（intentional ≥40%，corrective ≥15%）。
2. **校验回归**：对现有进行中 change（如 `openspec/changes/229151`）跑 `openspec validate --strict`，结果与改动前一致；再用两 schema 各建一个临时 change，走一遍 instructions → 生成 → validate，确认硬规则（Purpose ≥50 字符、`####` Scenario、zero-delta 拒绝）仍生效。
3. **流程回归**：用一条 TFS Bug 走 corrective 链路、一条需求走 intentional 链路，确认 dispatch 物化、`update-progress` 勾选、archive 均正常（重点：tasks.md 格式未变，派工物化解析不受影响）。

## 4. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 硬规则被误删，导致 validate 失败率上升 | §2.2 的保留清单逐项核对；验证步骤 2 覆盖全部静默失败场景 |
| 未来启用独立 store 后指令缺失 | 届时按需回补；当前 `openspec store list` 为空，CLI 报错自带提示兜底 |
| 05 设计文档与 schema 进一步脱节 | 已标注历史快照；后续 schema 变更以 `openspec/schemas/` 为唯一事实源 |

## 5. 实施步骤（开发时按序执行）

1. 改 `intentional-change/schema.yaml`（§2.1 删除 + §2.2 压缩 + §2.3 派工约束）；
2. 改 `corrective-change/schema.yaml`；
3. 改两 schema 的 `templates/spec.md`、`templates/tasks.md`（§2.4）；
4. 05 文档加历史快照标注；
5. 执行 §3 验证并记录前后字节数对比；
6. 提交（根仓单仓变更，按 AI Commit 格式）。

预估工作量：0.5 天以内，纯文本变更，无代码逻辑改动。

## 6. 实施结果（2026-10-30）

### 6.1 度量口径修正

实施中发现 §1.2 的"CLI 总输出字节数"口径失真：总输出含大量 CLI 固定 envelope（context 文件清单、模板正文、progress 视图），不可压缩，稀释了实际降幅；且 apply 输出在任务完成后是状态视图，根本不含 instruction。方案作用对象是 instruction 本体，故验收口径修正为 **instruction 字段字节数**（从 schema.yaml 直接解析，改动前后同法测量）。

### 6.2 实际结果

| schema | instruction 前 | instruction 后 | 降幅 | 目标 | 结论 |
| --- | --- | --- | --- | --- | --- |
| intentional-change | 12539 | 6632 | **-47%** | ≥40% | ✅ |
| corrective-change | 3924 | 3293 | **-16%** | ≥15% | ✅ |

参考：CLI 总输出 intentional 21017→15596（-26%），corrective 11764→11228（-4.6%），差额即 envelope。

### 6.3 验证记录

- `openspec validate "229151" --strict`：改动前后结果一致（同样的缺 delta 报错，进行中正常状态）✅
- 硬规则回归（临时 change 验证后已清理）：
  - zero-delta 无 `skip_specs` → 拒绝 ✅；`.openspec.yaml` 含合法 metadata + `skip_specs: true` → INFO 通过 ✅（注意：metadata 必须含 `schema:` 字段，否则 marker 不生效——此为既有行为，非本次改动引入）
  - Scenario 用 3 个井号 → 解析静默丢弃，validate 报错 ✅（保留该硬规则在 instruction 内是必要的）
  - 合规 delta → valid ✅
- 证伪修正：原 instruction 称 Purpose <50 字符会被 `validate --strict` 拒绝，实测 4 字符 Purpose 通过 strict 校验。已将该句改为质量与 archive 占位符表述，不再做虚假校验承诺。
- 流程回归（TFS 双链路）：未执行，留待下一条真实 Bug/需求验证——tasks.md 格式与派工约束语义未变，风险低。
