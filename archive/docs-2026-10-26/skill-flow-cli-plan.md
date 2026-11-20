# skill-flow CLI 统一封装方案（机器安装模式）

> 状态：方案待评审（暂不开发）
> 日期：2026-10-23（v2：应评审决议，从"零依赖直跑 + 文件同步"改为"tfs-cli 式机器安装 npm 包"）
> 范围：`projects/multica/scripts/` + `projects/multica/workspace-skills/*/scripts/` 共 21 个确定性脚本
> 参照：`tools/tfs-cli/`（`docs/tfs-cli-plan.md`）的包结构与安装模式
> 关联文档：02 §5–§11（Delivery 生命周期）、05 §5/§11（Change Identity / Task Progress）、
> `workspace-skills/development-execution/references/change-progress-script-contract.md`（冻结契约）、
> `tfs-task-materialization-plan.md` §4.2、`tfs-state-writeback-plan.md` §4、
> `multi-daemon-root-repo-resolution-plan.md`（R-14）、`workspace-provisioning-plan.md` §2、
> `workspace-skill-portability-plan.md` §3.4

## 1. 背景

workspace-skills 层现有 21 个确定性脚本，遵守同一套运行契约（零 npm 依赖、Node ≥ 23.6 直跑、
stdout 只出 JSON、日志走 stderr、退出码 0/2/3/64 语义统一），存在两类问题：

1. **样板代码大量复制**：`resolveCommand`（Windows where.exe 解析）、`quoteArg`（CRT 引用规则）、
   `parseArgs`、`UnknownError`、multica/tfs CLI spawn 封装在 13–14 份脚本中逐份复制，
   纯重复约 1,000–1,500 行（脚本总量 5,795 行的 20–25%），且副本已开始漂移。
2. **入口分散**：21 个路径散落在 15 个 Skill 目录与 `projects/multica/scripts/`，
   SKILL.md 各自硬编码路径，跨 Skill 调用已出现。

v1 方案（零依赖直跑 + 共享 `_runtime` + shim）在评审中被否决：为消灭 spawn 兼容与参数解析样板，
自行维护一份 `_runtime` 不如直接采用 `execa`/`commander` 等成熟依赖；且 `tools/tfs-cli` 已验证
"机器安装 npm 包 + registry 配置指向"的模式在本工作区可行。本方案（v2）改为完全对齐 tfs-cli 模式。

### 1.1 目标

- skill-flow 封装为 npm 包（`tsc` 构建、`bin` 注册、机器级安装），21 个脚本收编为其子命令。
- 引入 npm 依赖消灭自维护样板：`execa`（跨平台 spawn，替代 13 份 Windows 解析/引号代码）、
  `commander`（参数解析 + `--help` 自描述）。
- `tsc` 完整类型检查替代 type-stripping 的"只擦除不检查"。
- 保持全部外部契约不变：stdout JSON 结构、退出码语义、对 tfs-cli / multica / openspec 的调用关系。
- 全程有序迁移：旧脚本路径在 SKILL.md 切换完成前保持可用，冻结文档以 addendum 过渡。

### 1.2 机器安装模式带来的性质变化（相对 v1，须明确接受）

| 维度 | v1（零依赖直跑） | v2（本方案，机器安装） |
| --- | --- | --- |
| 部署模型 | 文件同步资产（sync-workspace upsert，仓内=权威） | 机器级安装工具（同 tfs-cli），registry `runtime.skill_flow` 指向 |
| 执行环境要求 | Node ≥ 23.6（22.6+ 需 flag） | 普通 Node LTS 即可（运行 tsc 产物 dist/，无 type-stripping） |
| npm 依赖 | 禁止 | 允许（execa / commander 等） |
| 类型检查 | 无（types 仅擦除） | tsc 完整检查（build 即检查） |
| 版本管理 | 仓内文件即版本（content_hash 回读） | 包 semver + 各机器安装版本漂移管理（新增职责，见 §7） |
| scripts/ 目录 | 保留为 shim 长期存在 | 迁移完成后从 workspace-skills / multica/scripts 移除（见 §8） |

### 1.3 非目标（明确不做）

- **不改变任何命令的业务语义**：stdout JSON 结构、退出码、result 枚举、前置校验逻辑保持原样；
  本方案是结构性重构。
- **不改变外部命令依赖关系**：仍 spawn 调用 tfs-cli / multica / openspec，
  不改为 SDK 直连（`azure-devops-node-api` 直连是另一个独立议题，预留 `src/clients/` 分层吸收）。
- **不重写 `export_multica_workspace.py`**：Python 只读导出工具，保留独立。
- **不发布到公共 npm registry**：仓内包，机器上从源码 `npm install && npm run build` 安装（同 tfs-cli）。

## 2. 命名与形态

- 包名：`@winning/skill-flow`（对齐 `@winning/tfs-cli` 命名空间）。
- bin 命令：`skill-flow`（kebab-case，与仓内脚本命名风格一致；全小写避免 Linux 大小写坑）。
- 包位置：`tools/skill-flow/`（对齐 tfs-cli 的存放先例；multica 相关工具集中于 `tools/`）。
- 调用形态：`skill-flow <group> <command> [args...]`（commander 两级子命令）。
- registry 配置：`repo-registry.json` 的 `runtime` 段新增 `skill_flow` 字段
  （默认 `"skill-flow"`，经 PATH 解析；机器上非标准安装时配置绝对路径，同 `tfs_cli` 的处理方式）。

## 3. 命令布局

### 3.1 flow 组 — delivery 链路命令

| 命令 | 来源脚本 | 说明 |
| --- | --- | --- |
| `skill-flow change resolve-identity` | `projects/multica/scripts/resolve-change-identity.ts` | Change 身份只读解析（冻结契约 §1） |
| `skill-flow change update-progress` | `projects/multica/scripts/update-task-progress.ts` | tasks.md checkbox 串行写入（冻结契约 §2） |
| `skill-flow analysis validate` | `delivery-gate/scripts/validate-analysis.ts` | Analysis Gate 确定性检查 |
| `skill-flow analysis complete` | `analysis-completion/scripts/complete-analysis.ts` | 分析收口 + TFS 置已分析 |
| `skill-flow dev materialize` | `delivery-flow/scripts/materialize-development.ts` | Development 派发物化 |
| `skill-flow dev check-completion` | `development-execution/scripts/check-development-completion.ts` | Engineering Contract 检查 |
| `skill-flow tfs materialize-tasks` | `delivery-flow/scripts/materialize-tfs-tasks.ts` | TFS 任务项物化 |
| `skill-flow tfs resolve-tasks` | `delivery-flow/scripts/resolve-tfs-tasks.ts` | TFS 任务批量置已解决 |
| `skill-flow tfs reconcile-workitem` | `tfs-sync/scripts/reconcile-workitem.ts` | 工作项对账 |
| `skill-flow pr materialize` | `pull-request/scripts/materialize-pr.ts` | PR 物化 |
| `skill-flow pr worktree` | `pull-request/scripts/worktree.ts` | worktree 操作 |
| `skill-flow pr reconcile-status` | `pr-status-sync/scripts/reconcile-pr-status.ts` | PR 状态对账 |
| `skill-flow delivery route-decision` | `delivery-flow/scripts/route-human-decision.ts` | Human Decision 路由 |
| `skill-flow delivery finalize` | `finalize-delivery/scripts/finalize-delivery.ts` | 交付收口 |

### 3.2 workspace 组 — 运维/供给命令（与 flow 组隔离）

| 命令 | 来源脚本 | 说明 |
| --- | --- | --- |
| `skill-flow workspace provision` | `projects/multica/scripts/provision-workspace.ts` | 平台对象供给 reconcile |
| `skill-flow workspace sync` | `projects/multica/scripts/sync-workspace.ts` | Skill 资产渲染 + 平台同步 |
| `skill-flow workspace migrate-repo-keys` | `projects/multica/scripts/migrate-repo-keys.ts` | repo_key 收敛迁移 |
| `skill-flow workspace check-daemon` | `projects/multica/scripts/check-daemon-setup.ts` | daemon 部署检查 |

### 3.2a runtime 组 — 运行时路径解析工具

| 命令 | 来源脚本 | 说明 |
| --- | --- | --- |
| `skill-flow runtime resolve-root-repo` | `workitem-analysis/scripts/resolve-root-repo.ts` | 根仓路径运行时解析（multi-daemon-root-repo-resolution-plan §4/§7） |

### 3.3 不纳入

| 脚本 | 原因 |
| --- | --- |
| `export_multica_workspace.py` | Python 实现，只读导出，保留独立 |
| `multica-workspace-bootstrap/scripts/workspace-bootstrap.mjs` | 一次性 bootstrap，可按需后续收编为 `workspace bootstrap`（本方案不强制） |

## 4. 包架构

### 4.1 目录结构

```text
tools/skill-flow/
  package.json                 # @winning/skill-flow，bin: skill-flow → dist/index.js
  tsconfig.json                # 对齐 tools/tfs-cli/tsconfig.json
  README.md                    # 构建/安装/命令清单（对齐 tfs-cli README 体例）
  src/
    index.ts                   # commander 入口：注册两级子命令 + --help
    cli/
      args.ts                  # 共用参数定义（--config/--issue/--root-repo 等）
      output.ts                # stdout JSON 写出 / stderr log / 退出码语义
    clients/
      multica.ts               # multica CLI client（issue get/metadata set/agent get/comment）
      tfs.ts                   # tfs-cli client（WIQL/set-state/branch get）
      openspec.ts              # openspec CLI client（validate/new change）
      spawn.ts                 # execa 封装：registry 解析命令路径 + stderr 日志 + argv 留痕开关
    commands/
      change/resolve-identity.ts
      change/update-progress.ts
      analysis/validate.ts
      analysis/complete.ts
      dev/materialize.ts
      dev/check-completion.ts
      tfs/materialize-tasks.ts
      tfs/resolve-tasks.ts
      tfs/reconcile-workitem.ts
      pr/materialize.ts
      pr/worktree.ts
      pr/reconcile-status.ts
      delivery/route-decision.ts
      delivery/finalize.ts
      workspace/provision.ts
      workspace/sync.ts
      workspace/migrate-repo-keys.ts
      workspace/check-daemon.ts
      runtime/resolve-root-repo.ts
  dist/                        # tsc 产物（gitignore，机器上 build 生成）
```

### 4.2 依赖选型

| 依赖 | 用途 | 替代的现有自维护代码 |
| --- | --- | --- |
| `execa` | 跨平台 spawn（Windows .cmd shim / 引号 / PATH 解析） | 13+ 份 `resolveCommand` / `quoteArg` / spawnSync 封装 |
| `commander` | 两级子命令路由、参数解析、`--help` 自描述 | 13+ 份 `parseArgs` / 用法错误处理 |
| `typescript` + `@types/node`（dev） | 构建与类型检查 | type-stripping 的无检查运行 |

引入第三方的纪律：仅限"替代已重复维护的样板"或"确定性校验能力"；每个新依赖在 package.json
评审中单独说明理由。`zod`（metadata JSON schema 校验）列为候选，首个版本不引入。

### 4.3 模块职责与硬约束

- **命令模块**：承载原脚本的前置校验、业务流程与输出组装；头部"实施事实"注释完整迁移。
  每个模块导出 commander 注册函数；命令模块之间禁止互相 import，共享逻辑只经 `clients/` / `cli/`。
- **`clients/`**：三个外部 CLI 的唯一消费点。上游输出格式变化只改这里；
  未来 SDK 直连替换 spawn 也只改这里。
- **`cli/output.ts`**：统一 exit 0/2/3/64 语义与 stdout JSON 写出；commander 的用法错误
  统一映射为 exit 64。
- **外部契约不变**：各命令 stdout JSON 字段、result 枚举、退出码与原脚本逐项一致。
- **环境变量不变**：`TFS_PAT` 仍只走环境变量；multica 认证、openspec cwd 语义不变
  （命令模块禁止 chdir）。

## 5. 错误输出标准化

统一 `cli/output.ts` 时收敛 exit 2/3 的输出格式，使 Agent 失败自愈无需读源码：

```json
{
  "result": "FAIL",
  "reasons": ["<逐条结构化原因>"],
  "recovery": "<可选：确定性修复提示，如 '重跑 skill-flow tfs materialize-tasks 补齐'>",
  "facts": { "<已落账/未落账事实，区分平面>" }
}
```

- 各命令原有 `reasons`/`result` 字段与枚举值**不变**；`recovery`/`facts` 为新增可选字段，
  逐命令在后续迭代补齐，不阻塞本方案主体。
- 原则：错误输出自描述到"Agent 不需要打开源码即可决定下一步"。

## 6. 外部命令依赖的影响评估

CLI 化前后，对 tfs-cli / multica / openspec 的调用关系**完全等价**：

```text
现状：  Agent → node xxx.ts → spawnSync(multica / tfs-cli / openspec)
本方案：Agent → skill-flow（dist/index.js）→ execa(multica / tfs-cli / openspec)
```

- 命令路径解析来源不变：registry `runtime.multica_cli` / `runtime.tfs_cli`（新增 `runtime.skill_flow`
  只用于 Agent 找到 skill-flow 自身，不影响三个下游）。
- execa 内部处理的正是现在 `resolveCommand`/`quoteArg` 手工实现的 Windows 解析逻辑，行为对齐；
  迁移验证须覆盖到 argv 级别（§8.3）。
- 反向收益：三个外部 CLI 的消费点从 21 份脚本收敛为 `clients/` 3 个模块，上游输出变化单点吸收。

## 7. 部署与版本管理（机器安装模式的新增职责）

### 7.1 安装

对齐 tfs-cli 的方式，写入运维文档（`multica-delivery-operations-guide.md` 增补）：

```bash
cd tools/skill-flow
npm install
npm run build          # 产出 dist/index.js
npm link               # 可选：注册全局 skill-flow 命令
```

- 需要安装的机器：全部 dev 机 + 全部 daemon 主机（凡 Runtime 会执行 delivery 链路命令的环境）。
- 安装后 `repo-registry.json` 的 `runtime.skill_flow` 可省略（默认 PATH 解析）或指向绝对路径。

### 7.2 版本漂移管理

文件同步模式下"仓内=权威"自动保证版本一致；机器安装模式下版本一致性是新增风险，对策：

1. 包 semver 管理，`skill-flow --version` 输出版本。
2. **命令内嵌最低版本自描述**：SKILL.md 调用处不检查版本；改为 `skill-flow` 在
   `--help` 与各命令输出中带 `tool_version` 字段，交付流程的 Gate 类命令（analysis validate /
   dev check-completion）输出中固定携带，出问题时可追溯。
3. 升级纪律：skill-flow 有提交 → 相关机器的运维文档要求重跑 `npm install && npm run build`；
   daemon 主机的升级纳入 `check-daemon` 命令检查项（新增 `skill_flow_version` 检查，
   与 registry 声明的期望版本比对）。
4. registry `runtime.skill_flow` 支持 `"skill-flow@>=1.2.0"` 形式的期望版本声明（可选增强，
   首版可只存路径，版本检查放 check-daemon）。

## 8. 兼容与迁移策略

### 8.1 与文件同步体系的关系变更

现状：`sync-workspace.ts` 把各 Skill 的 SKILL.md + scripts/ 逐文件 upsert 到平台，仓内=权威。

迁移后：

- **SKILL.md 仍是文件同步资产**（Agent 指令，必须同步）。
- **scripts/ 退出同步体系**：命令实现在 npm 包内，平台侧不再需要 scripts/ 文件。
- SKILL.md 调用行从 `node <skill-dir>/scripts/xxx.ts ...` 改为 `skill-flow <group> <cmd> ...`。
- sync-workspace 的 reconcile 会将平台侧多出的 scripts/ 文件列为 deleted_remote 删除——
  **必须先完成全部 SKILL.md 切换，再移除仓内 scripts/**，顺序反了会让平台 Runtime 在迁移窗口期
  执行到指向已删文件的旧指令。

### 8.2 冻结契约与路径引用的过渡

机器安装模式下，"脚本路径"这个概念本身消失，被"skill-flow 子命令"替代。受影响文档：

| 引用方 | 现状引用 | 过渡方式 |
| --- | --- | --- |
| `change-progress-script-contract.md`（冻结） | `projects/multica/scripts/resolve-change-identity.ts` 等路径 + 用法行 | **addendum**：自 \<date\> 起实现迁入 `@winning/skill-flow`，调用改为 `skill-flow change resolve-identity`；契约语义（result 枚举/exit/创建闭环）不变；05 §11 裁决 D3 同步补记"位置约定由包收编 supersede" |
| 05 §11 裁决 D3 | 两脚本位置钉死 | 同上，以补记形式 supersede，不改冻结正文 |
| `tfs-task-materialization-plan.md` §4.2 等各 plan | 各脚本路径 | addendum 登记新命令名 |
| 15 个 SKILL.md | `node <path>/scripts/xxx.ts` 调用行 | 逐批改写为 `skill-flow` 调用 |

裁决 D3 是对"位置"的裁决，改为机器安装是部署模型变更，**评审通过本方案即视为发起 D3 修订**，
实施前在 05 与冻结契约中完成 addendum，作为 Phase 1 的开工条件。

### 8.3 迁移纪律

- 结构迁移与语义变更严格分离：禁止在同一提交中既迁移命令又改业务逻辑。
- 每个命令迁移后的等价性验证（完成条件）：
  1. **stdout/exit 等价**：同输入下 `skill-flow <cmd>` 与原脚本的 stdout JSON 与退出码逐项一致
     （各命令 1–2 个代表性用例 + 1 个 FAIL 用例 + 1 个用法错误用例）；
  2. **argv 等价**：`clients/spawn.ts` 留痕开关（stderr 输出完整外部命令 argv），
     迁移前后各跑一遍，diff 外部命令调用序列一致——覆盖 execa 与原手工封装的 Windows 行为差异。
- 迁移窗口期：仓内旧脚本保持可用，直到对应 SKILL.md 完成切换并通过验证。

## 9. 分阶段实施

| 阶段 | 内容 | 产出 | 粗估 |
| --- | --- | --- | --- |
| Phase 0 | 包脚手架（package.json/tsconfig/commander/execa/clients 骨架）+ 试点对（change resolve-identity / change update-progress）迁移 + 等价性验证 | 可安装的 `@winning/skill-flow` 雏形 | 1 天 |
| Phase 1 | 铺开剩余 16 个命令迁移（flow 组先行）+ 全部等价性验证；同步完成 05/冻结契约 addendum（开工条件） | 19 个命令全部可用 | 3–4 天 |
| Phase 2 | 安装落地：dev 机 + daemon 安装 runbook；registry `runtime.skill_flow`；check-daemon 增加 skill_flow 版本检查；运维文档增补 | 全部执行环境就绪 | 1 天 |
| Phase 3 | SKILL.md 逐批切换调用行（flow 组先行，workspace 组随后），逐 Skill 验证 | 15 个 SKILL.md 更新 | 1 天 |
| Phase 4 | 移除仓内 scripts/（workspace-skills 14 个 + multica/scripts 6 个 TS），sync-workspace reconcile 清理平台侧；`export_multica_workspace.py` 保留 | scripts/ 退出同步体系 | 0.5 天 |
| Phase 5 | 错误输出 `recovery`/`facts` 字段逐命令补齐（可并行、可延后） | 失败自愈能力增强 | 持续 |

## 10. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 各机器 skill-flow 版本漂移（新模式最大风险） | 不同环境行为不一致 | §7.2：semver + `--version` + check-daemon 版本检查 + 升级纪律写入运维文档 |
| daemon 主机未安装/安装失败 | delivery 链路在 daemon 上断裂 | Phase 2 的 check-daemon 检查先行；安装纳入 daemon 部署 checklist（与 tfs-cli 同一流程） |
| execa 与原手工 spawn 封装的 Windows 行为差异 | 隐性回归 | §8.3 argv 级等价验证；试点对优先验证 |
| SKILL.md 切换与 scripts/ 移除顺序错误 | 平台 Runtime 执行到指向已删文件的指令 | §8.1 硬顺序：SKILL.md 全切完 → 再删仓内 scripts/ → reconcile 清理平台侧 |
| 冻结契约与实现漂移 | 契约可信度下降 | Phase 1 开工条件：05/冻结契约 addendum 完成 |
| npm 供应链面（新增） | lockfile 维护、依赖审计 | 依赖最小化纪律（§4.2）；package-lock.json 入库；仅仓内分发不发公共 registry |
| tsc 构建产物与源码断层 | 调试需映射 | tsconfig 开 sourceMap；README 注明调试方式（`npm run build` 后直跑 dist 或 tsx 开发模式） |

## 11. 验收标准

1. `skill-flow --help` 输出 19 个命令的分组清单；`skill-flow --version` 输出包版本。
2. 19 个命令全部通过 §8.3 双层等价验证（stdout/exit 一致 + 外部命令 argv 序列一致）。
3. 全部目标机器（dev + daemon）完成安装，`check-daemon` 的 skill_flow 版本检查通过。
4. 15 个 SKILL.md 调用行全部切换为 `skill-flow` 形态，并通过各 Skill 既有验证流程。
5. 仓内 20 个 TS 脚本移除，平台侧 scripts/ 经 reconcile 清理；冻结文档 addendum 齐备。
6. `rg "function resolveCommand" projects/multica` 命中数 = 0（能力由 execa 承担）。
7. 对外契约零变化：tfs-cli / multica / openspec 的调用关系、TFS_PAT 传递、openspec cwd 语义不变。

## 12. 评审待决项

1. 包位置：`tools/skill-flow/`（默认，对齐 tfs-cli）vs `projects/multica/skill-flow/`（贴近资产层）。
2. `zod` 是否首版引入做 metadata JSON schema 校验（建议：否，候选）。
3. `workspace-bootstrap.mjs` 是否收编为 `workspace bootstrap`（建议：暂缓）。
4. registry `runtime.skill_flow` 的期望版本声明格式（首版可只存路径）。
5. 05 §11 裁决 D3 的 addendum 措辞与生效日期。
