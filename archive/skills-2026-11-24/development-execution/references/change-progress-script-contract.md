# Change Identity / Task Progress 脚本调用契约（冻结）

> 冻结日期：2026-10-23（change-identity-progress-wiring 方案 §3.4）。
> 本契约是 `resolve-change-identity.ts` 与 `update-task-progress.ts` 的唯一调用约定：后续 Verify 路线（缺口④）引用本文件；`development-execution`、`workitem-analysis`、`delivery-flow` 等消费方在各自 SKILL.md 内联所需枚举语义，不引用本文件。修改本契约须同步核对两个脚本的实际 `--help` 输出与 05 §5/§11（语义背景，根级现行版 `projects/multica/05-openspec-schema-implementation-design.md`）。
> 语义背景：05 §5（Change Identity）/§11（Task Progress Update），根级现行版 `projects/multica/05-openspec-schema-implementation-design.md`；脚本头部注释为实施事实。

## 1. resolve-change-identity.ts — Change 身份只读解析

```bash
node projects/multica/scripts/resolve-change-identity.ts --openspec-root <root> \
  [--change-ref <stable-change-id>] [--tfs-id <id>] [--expect-schema <name>]
```

- **只读**：不创建/不修改任何 Change 与 Multica 事实（05 §5.2/§5.6）。
- 查找顺序：persisted `change_ref` 主查找 → active 恢复查找（排除 `archive/`，按 `<semantic-slug>-<tfs-id>` 稳定后缀匹配）→ archive 回退（剥脱 `YYYY-MM-DD-` 日期前缀按逻辑 ID 匹配）。
- stdout 只出 JSON：`{ "result", "change_ref", "path", "archived", "schema" }`；日志走 stderr。

| result | 语义 | exit | caller 处理 |
|---|---|---|---|
| `ACTIVE_FOUND` | 唯一活跃候选（含主查找命中、恢复唯一候选） | 0 | 采用其 `change_ref`；Multica 引用缺失/不一致时回写修复（05 §5.5 Case A），**禁止重建** |
| `ARCHIVED_FOUND` | 仅 archive 存在（逻辑 ID 匹配） | 0 | STOP：不重新应用 Delta、不新建同 ID Change（05 §5.5 Case B），交 Delivery Lead 判定 |
| `NOT_FOUND` | 无任何候选 | 0 | 仅此时允许创建新 Change（且须满足 05 §5.4 创建契约全部前置） |
| `CONFLICT` | >1 合法候选 | 2 | STOP（UNKNOWN），交 Delivery Lead / Human；**禁止按目录顺序取第一个** |
| `INVALID` | 候选损坏 / schema 与 `--expect-schema` 不符 | 2 | STOP（UNKNOWN），交 Delivery Lead / Human；禁止自动创建掩盖异常 |
| — | 未预期 IO / 环境错误 | 3 | UNKNOWN：如实报告已验证/未验证项，不猜测 |
| — | 参数用法错误 | 64 | 修正调用方 |

### 创建闭环（仅 NOT_FOUND 后，05 §5.4）

```text
openspec new change <semantic-slug>-<tfs-id> --schema <corrective-change|intentional-change>
→ 回读 .openspec.yaml 校验 change id + schema
→ change_ref 写入 Multica（analysis.change_ref）→ 回读确认
```

Route→Schema 映射（02 §5.3）：`bug-fix`/`production-fix`→`corrective-change`；`sdd-fast`→`intentional-change`；不按 TFS Type 机械二分。创建禁令（05 §5.4）：Human Reject 不新建、Development Rework 不新建、change_ref 暂时缺失不直接新建、不用 title 相似度猜测。

## 2. update-task-progress.ts — tasks.md checkbox 串行写入

```bash
node projects/multica/scripts/update-task-progress.ts --openspec-root <root> \
  --change-ref <stable-change-id> --check <1.1,1.2,...>
```

- 只执行 `[ ] → [x]` 确定性 patch，**不判断任务是否语义完成**（完成判断是 caller 的前置责任）；只勾显式指定且当前未勾的项，不自动扩大范围。
- 机制：`tasks.md.patch-lock` 进程级锁（wx 原子抢占 + owner 记录 + 有界重试 ~200ms/上限 30s + 退出清理 + stale 接管）→ 锁内重读 → 原子写入（临时文件 + fsync + rename）→ 回读核对。不写 git、不 commit。
- stdout 只出 JSON：`{ "result", "change_ref", "checked", "skipped_already", "detail?" }`；日志走 stderr。

| result | 语义 | exit | caller 处理 |
|---|---|---|---|
| `UPDATED` | 本次勾选成功 | 0 | 继续；`checked` 记入 Evidence |
| `ALREADY_COMPLETE` | 目标已勾，幂等跳过 | 0 | 继续；Evidence 标注 `skipped_already`（可能存在重复 Runtime，05 §11.2），不重复改写制造"第二次完成" |
| `BUSY` | 30s 有界重试后锁仍不可获得 | 2 | Skill 级有界重试（≤3 次，间隔 ≥30s）；仍 BUSY → UNKNOWN：**暂停发布 READY / Gate 不得 PASS**，已形成的验证证据保留可复用（05 §11.5） |
| `CONFLICT` | 目标行锁内重读时已变化/消失/编号重复（05 §11.4） | 2 | STOP 交 Delivery Lead：**不假勾、不覆盖**；工具报错与文件目视事实矛盾时允许 caller 先按 bounded-diagnosis 做有界鉴别（≤3 轮排除行尾 CRLF / 编码等解析层假阳性）再升级 |
| `INVALID` | 输入 / Change / tasks.md contract 非法 | 2 | STOP 交 Delivery Lead |
| — | 未预期 IO / 环境错误 | 3 | UNKNOWN：如实报告 |
| — | 参数用法错误 | 64 | 修正调用方 |

### 调用时机与前置（按角色）

| 角色 | 前置条件（05 §11.1/§11.5） | task_refs 来源 |
|---|---|---|
| Engineer（development-execution） | Development Completion Check PASS 之后、发布 READY 之前 | 本轮实际完成且证据有效的 assigned `task_refs`；失败/未完成任务不传入 |
| Verify Agent（缺口④，预留） | 已实际执行 assigned Verification Task 且证据有效；**不以 Verification Gate PASS 为前置，不经过 Engineer 的 Development Completion Check** | 已执行的 assigned Verification Task 编号 |

两类调用方共用同一脚本与枚举处理表；脚本输出 JSON 原文记入各自 Evidence。

## 3. 通用纪律

- 两脚本为唯一入口：`change_ref` 解析与 tasks.md checkbox 写入不得保留平行的自建逻辑（finalize-delivery 的长临界区内联 `resolveChangeDir` 是既定例外，见 openspec-schema-landing 方案 §7）。
- stdout JSON 是唯一机器契约；stderr 日志仅供人读。
- 脚本路径相对根仓：`projects/multica/scripts/`；`--openspec-root` 由调用方显式传入本次实际根仓路径，不硬编码。

---

## Addendum 2026-10-23：rondo 收编（部署模型变更，契约语义不变）

两脚本实现已迁入统一 npm 包（机器安装模式）
`@winning/rondo`（仓内 `tools/rondo/`；2026-11-04 起取代原 `@winning/skill-flow`，命令语义不变）：

| 本契约脚本 | 迁移后调用 |
|---|---|
| `projects/multica/scripts/resolve-change-identity.ts` | `rondo change resolve-identity`（参数不变） |
| `projects/multica/scripts/update-task-progress.ts` | `rondo change update-progress`（参数不变） |

- **契约语义不变**：本文件 §1/§2 的 result 枚举、退出码、stdout JSON 结构、只读/串行写入语义、
  创建闭环、调用时机与前置全部继续有效；stdout JSON 仍是唯一机器契约。
- **位置约定变更**：05 §11 裁决 D3 的"脚本位置 projects/multica/scripts/"由包收编 supersede；
  迁移窗口期（SKILL.md 全部切换完成前）原路径脚本保持可用，窗口期结束后原路径移除。
- **等价性**：迁移经双层等价验证（同输入 stdout/exit 一致 + tasks.md 副作用一致），
  验证记录见 skill-flow-cli-plan 实施 Phase 0（23/23 用例通过，仅 --help 用例行按新命令名更新）。
- 安装：机器级 `cd tools/rondo && npm install && npm run build`（daemon 与 dev 机同 rondo 流程）。
