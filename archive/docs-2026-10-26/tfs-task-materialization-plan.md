# tfs-task-materialization 方案（TFS 任务项物化：派发时回 TFS 建任务子项）

> 状态：**已实施并验收（2026-10-19）**。TF-1～TF-9 全过；平台 `delivery-flow` 的 SKILL / 脚本 / facts 契约已同步。实测记录与实施偏差见 §6。
> 上游权威：02 §7（materialize-development 职责清单含"按 TFS Type 补齐必要 TFS Task / 关联"，`docs/02-…v1.6.6.md:1261`）。
> 关联：`docs/delivery-flow-plan.md`（缺口⑤，本方案是其 §7"明确不做"清单中 TFS Task 创建项的补做）；`workspace-skills/delivery-flow/references/dispatch-facts-contract.md`（dev.dispatch 事实契约）；`services/tfs-cli`（TFS 侧唯一写入口）。

## 0. 背景与定位

**现象**：FOMA-35（TFS 257739）全程走通（分析→批准→派发→研发→归档），但 TFS 需求下无任务子项——管理侧在 TFS 看不到需求分解。

**根因**：delivery-flow 落地时裁定"当前流程不消费 TFS 子任务，实测有需要再补"（delivery-flow-plan §7）。本方案即"有需要"后的补做。

**定位**：TFS 任务项是**管理平面**产物（给组织管理侧可见性），交付平面（状态机/门禁/验收/收口）不消费它。设计目标：补上 TFS 侧可见性，**绝不允许** TFS 侧故障阻塞交付派发。

**范围裁定**：

| 项 | 依据 | 裁定 |
|---|---|---|
| 派发时在 tfs.id 需求下建任务子项 | 02 §7 | **本方案实施** |
| 幂等重跑 / 故障修复（§7.3 语义） | 02 §7.3 | **本方案实施** |
| TFS 任务状态随交付进度回写 | 02 未定义 | **不做**（如需另立方案） |
| CANCEL_DELIVERY 时 TFS 任务清理 | 02 明文未定义（§11.2 边界声明） | **不做**，保持安全停止交 Human |
| 工时/指派等管理字段 | 02 未定义 | **不做**，只建最小骨架 |

## 1. 设计约束（红线）

1. **平面隔离**：TFS 任务创建失败**不得**阻塞/回滚已完成的派发（dev.dispatch 已落账即交付事实成立）；TFS 段故障独立报 UNKNOWN，修复靠重跑补齐，不重新派发。
2. **幂等**：身份 = `(issue_key, task_ref)`；同一 task_ref 已建任务（任何 dispatch 条目已记录 tfs_task_id）→ 跳过/核对，不重复创建（02 §11.2 单次触发语义同构）。
3. **Reference-not-Replication**：TFS 任务只承载标题 + 指向 Multica Issue / Change 的引用；需求内容、验收契约不回写 TFS（OpenSpec 是工程真相唯一家）。
4. **安全**：PAT 只走环境变量或 gitignored `services/tfs-cli/config/tfs.config.json`；禁止出现在命令行参数、stdout、日志、Multica 云侧配置。
5. **确定性脚本基线**：TS 单文件零构建零依赖；退出码 0/2/3/64；stdout 只出 JSON，日志走 stderr。
6. **`--no-start` 纪律不适用**：TFS 侧无 Run 概念；Multica 侧写入（dev.dispatch 补写 tfs_task_ids）仍走 metadata set，不触碰状态，天然无启动语义。

## 2. 资产布局

```text
services/tfs-cli/src/commands/workitem.ts     # 扩展：workitem create（§4.1）
services/tfs-cli/src/commands/query.ts        # 输出补 project / parentId（TFS 2018 父子过滤）
services/tfs-cli/dist/                        # 上述 src 与命令注册的同步构建产物

workspace-skills/delivery-flow/
  scripts/materialize-tfs-tasks.ts             # 新增（§4.2）
  references/dispatch-facts-contract.md        # dev.dispatch 条目新增可选字段 tfs_task_ids（§3）
  SKILL.md                                     # 调用契约与 UNKNOWN 自愈规则（§4.3）
```

**落点偏差裁定（记录备查）**：02 §7 把 TFS Task 创建列在 `materialize-development.ts` 内部职责清单。本方案将其拆为**独立脚本** `materialize-tfs-tasks.ts`，由 Lead 在派发成功后紧接调用——理由：平面隔离红线（TFS 故障不得阻塞派发）与独立重试（修复不需要重跑派发校验）。语义等价于 02 的"物化时补齐"，执行顺序上仍属同一派发动作窗口。

## 3. 事实契约（dispatch-facts-contract.md 扩展）

`dev.dispatch` 条目新增**可选**字段：

```json
{
  "task_refs": ["1.1", "1.2"],
  "engineer_id": "…",
  "dispatch_key": "FOMA-35#1.1,1.2#…",
  "active": true,
  "tfs_task_ids": {"1.1": 258001, "1.2": 258002}    ← 新增；materialize-tfs-tasks 唯一写入者
}
```

- `tfs_task_ids` 以 task_ref 为键、TFS 任务 ID 为值；缺省 = 尚未物化（向后兼容既有条目）；
- ENGINEERING 返工使 dispatch 失效（`active:false`）时 **不动** `tfs_task_ids`——已建 TFS 任务保留（代表曾派工的事实）；新 dispatch 覆盖同 task_ref 时**复用**既有任务 ID，不新建（见 §4.2 幂等规则）。

## 4. 契约

### 4.1 tfs-cli 扩展：`workitem create`

```bash
node services/tfs-cli/dist/index.js workitem create \
  --type 任务 --title <title> --parent <tfs-id> \
  [--description-file <f>] [--project <p>]
```

- 实现：TFS 2018 REST `POST {project}/_apis/wit/workitems/$任务`（JSON Patch：`System.Title` + 可选 `System.Description` + `relations: System.LinkTypes.Hierarchy-Reverse` 指向父）；
- 类型名 `任务` 为中文本地化实例实测值（L3 已实证类型/状态中文名集）；父项目默认继承 PAT 默认项目，可用 `--project` 覆盖；
- 输出：`{id, type, title, parent, url, autoFilledFields?}`；退出码沿用基线 0/2/3/64；
- **必须先做只读验证**：创建前回读父项（存在性 + 类型为'需求'/'Bug'），父不存在 → exit 2；`materialize-tfs-tasks.ts` 另经 `query --wiql` 回读父项并取 `System.TeamProject` 作为创建项目。

### 4.2 `materialize-tfs-tasks.ts`（delivery-flow Skill）

```bash
node scripts/materialize-tfs-tasks.ts --config config/repo-registry.json --issue <KEY>
```

确定性流程：

1. **前置**（任一不过 → exit 2）：Issue 存在且 metadata 有 `tfs.id`；`dev.dispatch` 存在至少一条 `active:true` 条目；
2. **父项核对**：tfs-cli query 回读 `tfs.id`（存在、可取 TeamProject）；父项确定不存在 → exit 2（前置 FAIL 零创建），查询故障 → exit 3；
3. **逐 task_ref 幂等物化**：对所有 active 条目的 task_refs 求并集，每个 task_ref：
   - 该 Issue **任意** dispatch 条目（含已失效）的 `tfs_task_ids` 已有此 task_ref → query 核对 TFS 侧仍存在 → 跳过（输出 `reused`）；
   - 否则从 `openspec/changes/<change_ref>/tasks.md` 取该 task_ref 原生行文本（Native First，沿用 materialize-development 的定位正则）→ 组标题 `[<issueKEY> <task_ref>] <行文本>` → `workitem create`（父 = tfs.id，项目 = 父项 TeamProject；description 文件含 Issue KEY / change_ref / dispatch_key 引用）；
   - 创建成功 → 暂存 `{task_ref: tfs_id}`；
4. **回写**：将新建映射合并进对应 active 条目的 `tfs_task_ids`，`issue metadata set` 一次写回；**先创建后回写**（TFS 侧已建即事实，回写失败 → exit 3 输出已建/复用/认领暂存清单，重跑时经 query 核对可自愈——见下）；
5. **UNKNOWN 自愈**：重跑时对"已建但未回写"的孤儿任务，通过 `query --wiql` 按 `[<issueKEY> <task_ref>]` 标题前缀查询，再以 `parentId = tfs.id` 过滤并认领回写，不重复创建（TFS 2018 扁平 WIQL 不支持 `[System.Parent]`）。

输出：`{result, issue, parent, parent_project, created, reused, adopted, active_entries}`；UNKNOWN 若发生在逐条物化之后，同样携带暂存 `created/reused/adopted`。exit 0 全部就绪 / 2 前置失败（含父项确定不存在）/ 3 TFS 故障或回写失败。

### 4.3 SKILL.md 追加（Lead 侧路由表）

| 时机 | 动作 |
|---|---|
| `materialize-development` 返回 `dispatch_payload` / `sub_issue_created` / `sub_issue_activated` **之后** | 同 Run 内紧接调用 `materialize-tfs-tasks.ts --issue <KEY>`；exit 0 → 无追加动作；exit 3 → 如实回流派发结果 + TFS 段失败原因，**不回滚派发**，交 Human 决策是否重跑补齐 |

ENGINEERING 返工路由后**不**自动调用（复用语义已内建，如返工新增 task_ref 由 Lead 判断后手动补调）。

## 5. 平台注册

1. tfs-cli 扩展后重建 dist（本机构建产物直用，无平台注册）；
2. delivery-flow（`8f2861fd-…`）平台同步：SKILL.md 用 `skill update --content-file`；`scripts/materialize-tfs-tasks.ts` 与 `references/dispatch-facts-contract.md` 用 `skill files upsert`；
3. `agents/delivery-lead/README.md` 登记变更；
4. ops guide 缺口⑤与 `delivery-flow-plan.md` §7 更新 TFS Task 补做状态并指向本方案。

## 6. 验收（TF 系列）

测试纪律：只用指定测试工作项（TFS 256462 / 255512 / 256393 或新建专用测试需求）；验收后创建的任务一律 `workitem set-state` → 已关闭并标注测试用途；构造故障用非法父 ID / 断网代理，不动他人工作项。

| # | 用例 | 预期 | 实测（2026-10-19，FOMA-36 / TFS 256462） |
|---|---|---|---|
| TF-1 | 正常物化 | active dispatch 的每个 task_ref 在 tfs.id 下建任务（标题含 `[KEY ref]` 前缀），tfs_task_ids 回写一致 | ✅ `1.1→258235`、`1.2→258236`，父子链接与逐条回写一致，exit 0 |
| TF-2 | 幂等重跑 | 全量 `reused`，TFS 任务数不增，exit 0 | ✅ `created={}`，`1.1/1.2` 全量 reused，无新增任务 |
| TF-3 | 父项不存在 | exit 2（前置）零创建 | ✅ `tfs.id=99999999` → FAIL / exit 2，理由为父项不存在，零创建 |
| TF-4 | 部分创建后回写失败（构造） | exit 3 输出已建清单；重跑 → 孤儿认领回写，不重复创建 | ✅ 预置孤儿 `3.1→258257` 直接 adopted；另以 wrapper 只令 metadata set 失败：`4.1→258266` 创建后 UNKNOWN / exit 3 且输出 created 清单，正常重跑 adopted，同前缀任务仅 1 条 |
| TF-5 | 返工复用 | dispatch 失效 + 新 dispatch 同 task_ref → 复用旧任务 ID，不新建 | ✅ 旧 BE 条目 `active:false` 且保留 IDs；新条目无 IDs 重跑后复用 `258235/258236` 并只回写新 active 条目 |
| TF-6 | Sub-Issue 投影 | 与父投影行为一致（任务始终挂需求 tfs.id，与投影形态无关） | ✅ 新 BE 条目 `projection=sub_issue`，仍挂 256462 并复用相同任务 IDs，无额外创建 |
| TF-7 | 派发阻塞隔离 | TFS 段 exit 3 时 dev.dispatch 事实保持有效，Lead 输出如实区分两段结果 | ✅ 临时 config 指向无效 tfs_cli → UNKNOWN / exit 3；`dev.dispatch` 前后字符串完全一致；SKILL 已明确两段结果不得互相回滚 |
| TF-8 | tfs-cli create 契约 | 类型名/父子链接/描述文件正确落 TFS；PAT 不出现在任何输出 | ✅ TF-1/TF-9 创建的 4 个任务均为类型 `任务`、正确 `[FOMA-36 ref]` 标题与父链接，描述含 Issue / Change / Reference-not-Replication 指针；命令与输出无 PAT |
| TF-9 | 前后端双派发（多仓多 dispatch） | 父 Issue 两条 active dispatch（Backend+Frontend）→ 一次调用按并集建全量任务、按条目分别回写；顺序派发（先建后端 dispatch 并物化，再追加前端 dispatch 重跑）→ 后端 reused、仅新建前端任务，TFS 任务总数与 task_refs 并集一致 | ✅ 顺序追加 Frontend 后，BE `1.1/1.2` reused，FE `2.1→258251`、`2.2→258252` created；两条 active 条目分别回写；再次重跑 4 refs 全 reused |

验收清理：测试任务 `258235 / 258236 / 258251 / 258252 / 258257 / 258266` 均已评论标注测试用途并设为 `已关闭`；FOMA-36 已以 `--no-start` 取消；`openspec/changes/tf-acceptance-test/` 已删除，OpenSpec 根仓工作树干净。

实施偏差与实测修正：

1. **TFS 2018 父子过滤**：扁平 WIQL 实测不支持 `[System.Parent]`（TF51005）。`query` 输出向后兼容新增 `project` / `parentId`（从 `Hierarchy-Reverse` relations 提取）；孤儿认领改为标题 `CONTAINS` 查询 + `startsWith` 与 `parentId` 双重过滤。
2. **强制 FinishDate**：本实例创建 `任务` 时 HTTP 400 报告 `Microsoft.VSTS.Scheduling.FinishDate` Required/InvalidEmpty。`workitem create` 复用 set-state 的必填日期处理：补默认值后仅重试一次，并在输出 `autoFilledFields` 如实标注；这是 TFS 强制字段，不扩展为工时/指派等可选管理字段。
3. **父项失败分型**：父项经查询确定不存在属于前置 FAIL（exit 2、零创建）；查询命令/服务故障才是 UNKNOWN（exit 3）。以此统一 §4.2 与 TF-3 口径。
4. **引用描述不新增 URL 配置**：description 使用 Issue KEY + Change 路径 + task_ref + dispatch_key，未引入 Multica Issue URL 的额外配置；满足 Reference-not-Replication 的指针定位需要。

## 7. 明确不做

- TFS 任务状态回写（交付进度 → TFS 任务状态）——02 未定义，如需另立方案；
- CANCEL_DELIVERY 的 TFS 任务清理——02 明文边界（§11.2），交 Human；
- 工时、指派、迭代路径等可选管理字段（只建最小骨架：标题/父子链接/引用描述；TFS 强制 FinishDate 默认值例外见 §6 实测修正）；
- 存量 Issue 的批量补建（只服务新派发；存量如需补建，逐个手动触发本脚本即可，天然幂等）。

## 8. 开放问题

1. **任务标题来源**：v1 用 tasks.md 原生行文本；若实测发现行文本过长/含 markdown 标记不适合做 TFS 标题，再议截断/清洗规则（仍不解析语义）；
2. **任务指派**：v1 不指派（TFS 默认）；若管理侧要求任务挂到具体成员，需要 Engineer Agent ↔ TFS 成员映射表——届时另议，不进本方案；
3. **与缺口⑦（openspec-schema-landing）关系**：tasks.md 行定位正则依赖当前原生格式，⑦ 落地后若任务行格式变化，需回归 TF-1/TF-2；
4. **多 Change 并发**：当前"当前唯一 Change"约定下不存在；05/⑦ 若放开并发 Change，tfs_task_ids 的 task_ref 键空间需加 change_ref 前缀。
