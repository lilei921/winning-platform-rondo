# finalize-delivery 方案（缺口③：PR 收口、对账与最终完成）

> 当前契约提示（2026-10-22）：本文旧 `repos/`、`df-*` 示例与实测输出均为历史记录；当前仓库身份与路径以根仓 `docs/config/repo-context.yaml` 及 `multica-delivery-operations-guide.md` §3.5 为准。

> 状态：**已实施并验收（2026-10-15）**。平台注册记录见 `agents/delivery-lead/README.md`（Skill `ffff9bd5-bcdb-4f0f-b18d-7bf667636c99`，已绑定 Delivery Lead）。
> 上游权威：02 §11.3（PR Completed 收口链）/ §11.4（幂等与恢复）/ §12.1–12.4（PR Transition Gate、合并后工作区对账、Delivery Completion Gate、Final Completion）；本文不复制其语义，只做落地映射。
> 关联决策：ops guide §3.5（根仓直推 master + 临界区串行）、`docs/pull-request-capability-plan.md`（上游：`current_pr` 事实由其写回）、`docs/tfs-cli-plan.md`（TFS 工具层已验收）。

## 0. 定位

补齐交付闭环最后一段：

```text
required PR 全部 completed（TFS 侧人工合并）
  →（v1：Delivery Lead 观察后手动触发；缺口⑥ PR Status Sync Agent 落地后 same-run 调用）
  → finalize-delivery.ts：PR Transition Gate → 合并后工作区对账 → Delivery Completion Gate
  → Final Summary → Route Archive（OpenSpec Archive + 根仓 Commit）→ TFS 回写
  → Issue → done → 清 pending_event
```

02 §11.3 红线逐条落到本方案：进入收口前先持久化 `pending_event`；每个副作用先回读事实再补缺失项；父 Issue 的 `done` 是最后写入；`UNKNOWN` 升级 Delivery Lead，Happy Path 不额外唤醒 Lead。

## 1. 设计约束（红线）

1. **确定性逻辑全在脚本**：TS 单文件、零构建、零 npm 依赖、可擦除类型注解（Node 24 直跑实测约束：禁用 constructor parameter property 等非擦除语法）；退出码 `0` PASS / `2` FAIL / `3` UNKNOWN / `64` 用法错误；stdout 只出 JSON。
2. **TFS 交互一律经 tfs-cli**；Git 操作直接 spawn `git`；OpenSpec 归档调原生 `openspec` CLI（1.13.2 已装，`archive --yes --json`）。
3. **Skill 自包含**：平台 skill files 物化按 Skill 隔离目录（`.claude/skills/<name>/`），跨 Skill 相对引用不可靠——本 Skill 自带全部脚本与 config 副本，不引用 `pull-request` Skill 的文件。
4. **幂等恢复**（02 §12.4.2/§12.4.3）：有界调用，恢复依据当前事实（TFS / Git / OpenSpec / Multica 回读），不凭上轮日志认定成功；每步先核对既有对象，只补缺失项；不做补偿回滚。
5. **根仓临界区**（§3.5）：Archive + Commit 段串行化；只提交当前 Change 与其 Delta 实际更新的主规格，禁止 `git add .`；push 失败 `pull --rebase` 有界重试（≤3 次）。
6. **不伪造事实**：Human 批准、Verify PASS 等以持久化 metadata 事实为准，缺失即 UNKNOWN，不由脚本推断。

## 2. 资产布局

```text
workspace-skills/finalize-delivery/
  SKILL.md                        # 薄契约（When/Input/How/Validation/Output/Failure）
  config/
    repo-registry.json            # 与 pull-request Skill 同形状（runtime/repos_root/registry）+ openspec_root
  scripts/
    finalize-delivery.ts          # 主脚本（02 §11.3 收口链的确定性投影）
  references/
    finalize-facts-contract.md    # finalize.pending / analysis.human_approval 等 metadata 契约
```

**与 02 资产树的偏差及理由**：02 §13 资产树把 `finalize-delivery.ts` 列在 `delivery-flow/` 下。本方案单设 Skill：调用方是 PR Status Sync Run（Thin Adapter，缺口⑥）而非 Lead 协调方法；`delivery-flow` 其余脚本（materialize-development / route-verify-result / route-human-decision）属 Lead 语义，随缺口⑤另建。ops guide §8 缺口清单本就将二者分列（③ finalize-delivery / ⑤ delivery-flow 其余脚本）。

改动既有资产（最小侵入）：

- `agents/delivery-lead/instructions.md`：派发研发时写入 `analysis.human_approval` 事实（见 §3）；PR 合并后调用 finalize-delivery Skill 收口（v1 触发路径）；
- `agents/delivery-lead/README.md`：登记平台实例 ID 与绑定关系；
- `workspace-skills/pull-request/config/repo-registry.json`：补 `openspec_root` 字段（pull-request 脚本忽略该字段，保持单一 config 形状）。

**config 双副本纪律**：`repo-registry.json` 在 pull-request / finalize-delivery 两个 Skill 各存一份（物化隔离所致，红线 3）；registry 变更须同步两处并分别重新 `skill files upsert`。以 pull-request 仓内副本为源。

## 3. Facts 契约（Issue metadata）

### 已有事实（消费方）

| key | 来源 | finalize 用途 |
|---|---|---|
| `tfs.id` / `tfs.type` | tfs-sync | TFS 回写身份 |
| `analysis.route` / `analysis.change_ref` | analysis-completion | Change 定位；`sdd-standard` → FAIL（无自动收口路径，02 §12.4.1） |
| `analysis.gate.result` | analysis-completion | Completion Gate 前置（须 = PASS） |
| `analysis.verify_agent.recommendation` | analysis-completion | `required` 时须有有效 Verify PASS 事实（缺口④未建 → v1  UNKNOWN，不静默放行） |
| `current_pr` | materialize-pr.ts | required PR 集合：逐条 `pr get` 核终态、对账目标分支 |

### 新增事实（本方案）

| key | 写入者 | 内容 |
|---|---|---|
| `analysis.human_approval` | Delivery Lead（派发研发时） | JSON `{decision:"approved", by:<human>, at:<iso>, comment_ref?<id>}`；Completion Gate 的"人审已批准"机器可读投影。**缺失 → UNKNOWN**（不推断批准） |
| `finalize.pending` | finalize-delivery.ts（收口副作用开始前） | JSON `{event_keys:["<issue>#<repo_key>#<pr_id>#completed",...], recorded_at}`；§11.4 pending_event 的平铺投影。§12.4 后置条件全部确认后由脚本删除；**存在即表示尚需对账**，即使 Issue 已离开 `in_review` |
| `delivery.summary_comment_id` | finalize-delivery.ts | Final Summary 评论 ID；重试时凭它跳过重复评论（§12.4.3：不重复追加相同评论） |

## 4. 脚本契约 `finalize-delivery.ts`

```bash
node scripts/finalize-delivery.ts --issue <KEY|id> --config config/repo-registry.json
```

流程（02 §11.3 的确定性投影，每步先回读再动作）：

```text
0. 读 Issue + metadata：tfs.id / analysis.* / current_pr 齐备性；route ∈ {bug-fix, production-fix, sdd-fast}
   Issue 已 done 且 finalize.pending 存在 → 仅事实核对 + 清 pending（02 §12.4.3 末行），不重放副作用
1. 写 finalize.pending（若不存在；event_keys 由 current_pr × completed 终态生成）
2. PR Transition Gate（§12.1）：逐 current_pr 项 tfs-cli pr get
     全部 completed → 过；有 active → FAIL（等待合并）；有 abandoned / 查无 → UNKNOWN
     verify_agent.recommendation=required 且无 verify PASS 事实 → UNKNOWN
3. Post-Merge Workspace Reconciliation（§12.2）：逐仓
     枢纽克隆 fetch --prune → switch <target_branch> → pull --ff-only
     worktree 移除（存在且干净才删；脏 → UNKNOWN 拒删）→ git branch -d <source_branch>（拒则保留，绝不 -D）
     工作树非 clean / target 不存在 / 无法 ff → UNKNOWN（不 reset --hard）
4. Delivery Completion Gate（§12.3 的机器可判定子集）：
     analysis.gate.result=PASS；analysis.human_approval 存在且 decision=approved；
     tasks.md 无未勾选项（取消项须带理由标注）；Issue 当前无 blocked；
     无法机器确认的语义项（Evidence 有效性等）不重判——以既有 Gate/专业结论 metadata 为准
5. Final Summary：结构化事实模板渲染（非 LLM）→ 写 Issue 评论，评论 ID 回写 delivery.summary_comment_id
6. Route Archive（§12.4.1，根仓临界区内）：
     mkdir 锁（repos/.locks/root-finalize.lock/，内含 owner/pid/at；已占用 → UNKNOWN 报持锁者）
     → 锁内：git pull --rebase 对齐 → openspec archive <change_ref> --yes --json
     → 回读：change 目录已入 archive/、适用主规格已更新
     → git add 仅本 Change 相关路径（archive 前后 porcelain 差集归因，见 §5）→ commit → push（rebase 重试 ≤3）
     → 释放锁
7. TFS 回写：workitem set-state → 已解决 + 评论（摘要指针 + PR 链接）；已符合则跳过
8. 全部后置条件回读确认 → Issue status done（--no-start，最后写入）
9. 删 finalize.pending → stdout { result: "PASS", steps: {...} }
```

退出码：`0` PASS（全部后置条件确认）/ `2` FAIL（明确条件不满足：route 不支持、PR 仍 active、tasks 未勾完等，逐项 reason）/ `3` UNKNOWN（身份/事实/占用不可确认，交 Lead）/ `64` 用法错误。

中间失败：已完成步骤的既有事实保留，pending 保留，下次调用按 §12.4.3 逐动作核对补齐。

## 5. 根仓临界区与 Archive 归因

- **锁**：`mkdir` 原子创建锁目录（Windows 无 flock）；持锁 → UNKNOWN（不偷锁、不长等，有界调用原则）；脚本崩溃残留锁由 `prune` 维护动作或人工按 owner/at 判断清除（v1 不做自动 stale 回收）。
- **变更归因**：锁内 Archive 前先取 `git status --porcelain` 快照 A；Archive 后取快照 B；提交范围 = `openspec/changes/<change_ref>/`（含删除）+ `openspec/changes/archive/**` 新增 + (B−A) 中 `openspec/specs/**` 的变更条目。快照 A 已存在的 specs 修改（他人未提交工作）不纳入提交，且导致 UNKNOWN（根仓工作区不干净，交人工）——临界区进入条件是工作区对本 Change 之外干净。
- **Archive 参数纪律**（02 §12.4.1）：只在 Gate PASS 后传 `--yes`；禁止 `--no-validate`；无 Delta 的 Corrective Change 依赖原生跳过，不用 `--skip-specs` 掩盖应有同步。
- **push**：根仓 origin = gitee（ssh）；失败 `pull --rebase` 后重试 ≤3，仍失败 → UNKNOWN（Commit 事实保留本地，恢复时先查 git log 再补 push）。

## 6. 调用链

```text
v1（缺口⑥未建）：
  Delivery Lead 观察到 current_pr 全部 completed（人工/TFS 通知）
  → Lead Run 调用 finalize-delivery Skill → finalize-delivery.ts
  → PASS：Issue 已 done，Lead 汇总结束
  → FAIL：按 reason 等待/修复（如 PR 未合并），不绕过
  → UNKNOWN：Lead 语义判断；只有需改代码/rebase 才重新 @Engineer

目标态（缺口⑥落地后）：
  Autopilot → PR Status Sync Agent（Thin Adapter）→ reconcile 发现全 completed
  → 同一 Run 内调用 finalize-delivery.ts（02 §11.3 same-run deterministic finalize）
  → UNKNOWN/冲突才升级 Delivery Lead
```

Skill 绑定：v1 绑 Delivery Lead；PR Status Sync Agent 建立后加绑。

## 7. 验收（F 系列）

测试纪律：只用指定测试工作项；测试 PR 的 target 用一次性分支（如 `test/finalize-accept`，验收后删），**不向业务 master 合并测试 PR**；测试 Change 用 `finalize-test-<tfs-id>` 命名，验收后从根仓移除提交。

| # | 用例 | 预期 | 实测（2026-10-15，FOMA-28 / TFS 256462） |
|---|---|---|---|
| F0 | `openspec archive --yes --json` 行为探针（archive 目录命名、specs 合入、--json 输出形状） | 行为事实记录进本文 §5 附注 | ✅ openspec 1.13.2：archive 落 `openspec/changes/archive/<YYYY-MM-DD>-<name>/`；JSON `{archive:{change, archivedAs, path, specsUpdated}, root:{…}}`；无 delta 时 `specsUpdated:false` |
| F1 | Happy Path 全链（测试 Issue + 已完成的测试 PR + 全勾选测试 Change） | 对账成功、Summary 评论、Archive+根仓 Commit+push、TFS→已解决、Issue→done、pending 清除，exit 0 | ✅ exit 0；根仓 Commit `94260d4` 已 push；TFS 256462→已解决；FOMA-28→done；pending 清除。注：PR 3342 因 TFS mergeStatus 卡 `queued` 由人工网页端完成（测试环境事实，非脚本问题）；首轮发现 porcelain 首行被 trim 吞掉状态列前缀导致路径错位（`openspec/…`→`penspec/…`），修复 `porcelainPaths` 不做整串 trim 后通过 |
| F2 | PR 仍 active | exit 2 FAIL，零副作用 | ✅ exit 2（PR 3344 active）；FAIL 在写 pending 之前，门禁先于副作用的顺序得到验证 |
| F3 | 恢复：Archive 已完成、后续未做（预置该状态） | 不重复 Archive/Commit，只补 TFS 回写 + done + 清 pending | ✅ 由 F1 真实恢复 Run 覆盖：archive/summary/tfs 各步按既有事实 skipped，只补缺失步骤 |
| F4 | Issue 已 done 且 pending 残留 | 仅核对 + 清 pending，不重放任何副作用 | ✅ 仅清 pending，无任何重放 |
| F5 | 工作区脏（worktree 或枢纽有未提交改动） | exit 3 UNKNOWN，不 reset --hard、不强删 | ✅ 枢纽预置脏文件 → exit 3 UNKNOWN 拒绝切分支，交人工 |
| F6 | 根仓临界区被占（预置锁目录） | exit 3 UNKNOWN 报持锁者，不偷锁 | ✅ exit 3，reason 携带 owner.json 持锁者信息 |
| F7 | 成功后完整重跑 | 全步幂等 NO-OP：不重复评论/Commit/状态写入，exit 0 | ✅ exit 0，全步幂等 |
| F8 | 缺 `analysis.human_approval` | exit 3 UNKNOWN（不推断批准） | ✅ exit 3，明确"脚本不推断批准" |
| F9 | `sdd-standard` route | exit 2 FAIL（无自动收口路径） | ✅ exit 2 |

实施偏差记录（对照 §4/§5）：

1. **porcelain 首行解析**：`git status --porcelain` 首列是状态码，首行可能以空格开头；整串 `trim()` 会吞掉该空格使 `slice(3)` 错位。脚本改为对原始 stdout 逐行 split、不整串 trim（代码注释已留坑说明）；
2. **门禁先于 pending**：PR Transition Gate 与 Completion Gate 失败均发生在写 `finalize.pending` 之前，保证 FAIL/UNKNOWN 不留残留事实；
3. **TFS 测试 PR 完成度**：本 TFS 实例偶发 mergeStatus 卡 `queued` 导致 REST PATCH completed 静默无效（PR 3313 正常、3342 卡住），测试时以网页端人工完成兜底——这是 TFS 侧事实，脚本只消费 PR 终态、不受影响；
4. **Node 24 可擦除类型约束**：脚本不使用构造器参数属性等不可擦除语法（同 pull-request 方案记录的约束）。

## 8. 明确不做

- PR Status Sync 轮询与触发（缺口⑥，本方案只交付被调用的 finalize 入口）；
- PR abandoned 路径处理（02 §11.2 定向重开，属 Lead/delivery-flow 语义）；
- TFS 关联子 Task 的关闭规则（02 要求"按规则应关闭的关联 Task"，规则未定义——见开放问题）；
- `sdd-standard` 自动收口、CANCEL_DELIVERY 分支（02 §11 明文待专项契约）；
- 跨 Runtime 工作区迁移、锁自动偷取、`reset --hard` 类破坏性恢复；
- TFVC 仓。

## 9. 开放问题

1. **TFS 目标状态**：交付完成 = `已解决`（Resolved，留 QA/人工走已验证→已关闭）还是直写 `已关闭`？本方案默认 `已解决`，待团队约定确认；
2. **关联 Task 关闭**：TFS 需求下既有 Task 是否随 Delivery done 关闭、按什么规则，02 未定义，v1 不动关联 Task；
3. **Verify PASS 事实载体**：缺口④（Verify Agent）未建，`verify.result` metadata key 形状待该 capability 定稿；v1 `verify_agent.recommendation=required` 一律 UNKNOWN；
4. **Evidence 有效期复核深度**：§12.3 要求"有效 Evidence 满足 §10.2 收口前置"，但其语义有效性是专业判断——v1 机器侧只复核 checkbox 与 metadata 事实，Evidence 语义不重判（02 §12.4.1：finalize 不重跑 LLM 分析）。
