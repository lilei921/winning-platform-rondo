# pull-request capability 方案（PR 物化：研发 → TFS PR 闭环）

> 当前契约提示（2026-10-22）：本文旧 `repos/`、`df-*` 示例与实测输出均为历史记录；当前仓库身份与路径以根仓 `docs/config/repo-context.yaml` 及 `multica-delivery-operations-guide.md` §3.5 为准。

> 状态：**已实施并验收（2026-10-14，P1–P6 全过；平台注册完成前为本地已验收）**。
> 上游权威：02 §10.1（PR Preparation 最小输入契约）/ §10.2（PR Materialization 标准过程与幂等纪律）；本文不复制其语义，只做落地映射。
> 关联决策：ops guide §3.5（并发写隔离：业务仓 worktree）、§3.2.1（绝对路径派发纪律 / Skill 内相对路径）、`docs/tfs-cli-plan.md`（PR 工具层已验收）。

## 0. 定位

补齐交付闭环断链的研发出口段：

```text
Engineer 研发完成（development-execution，已有）
  → PR Preparation Facts 落 Issue（本方案 §3 契约）
  → Delivery Lead 协调 Run 调用 pull-request capability（本方案主体）
  → TFS PR 建/复用 + 工作项关联 + current_pr 回写 + Issue → in_review
  →（后续缺口③ finalize-delivery / ⑥ PR Status Sync 接管，不在本方案）
```

02 §10.2 红线逐条落到本方案：幂等（外部事实优先，已建 PR 复用登记不重建）；PR Title/Description 语义只有 Engineer 能改（脚本只校验客观事实）；调用入口唯一（Lead 协调 Run，不允许多入口并发建同一 PR）；无法可靠确认时 UNKNOWN。

## 1. 设计约束（红线）

1. **确定性逻辑全在脚本**：TS 单文件、零构建、零 npm 依赖，`node scripts/xxx.ts` 直跑；退出码 0 PASS / 2 FAIL / 3 UNKNOWN；stdout 只出 JSON。
2. **TFS 交互一律经 tfs-cli**（`services/tfs-cli/dist/index.js`，已验收 C0–C6）；脚本不直接碰 TFS API。脚本 → tfs-cli 用绝对路径调用（仓外工具），路径只出现在 config。
3. **Agent 零业务判断**：Lead 只触发脚本、读结构化结果、如实汇总；PR 语义准备（title/description/candidate commit）已在 Engineer 侧完成。
4. **幂等身份**：`current_pr` metadata + TFS 侧 `pr list` 外部事实双核对；外部已建而本地未登记 → 复用登记（02 §10.2 明文）；两者冲突 → UNKNOWN。
5. **worktree 纪律**（§3.5）：研发在 `repos/.worktrees/<issue>-<repo_key>/` 的 `feat/<tfs-id>` 分支；枢纽克隆 `repos/<repo_key>/` 不开发；worktree 创建/回收是脚本职责，不靠 Agent 自觉。

## 2. 资产布局

```text
workspace-skills/pull-request/
  SKILL.md                        # 薄契约（When/Input/How/Validation/Output/Failure）
  config/
    repo-registry.json            # repo_key → 物理路径 / TFS 仓名 / TFS 项目 / 默认 target branch
  scripts/
    materialize-pr.ts             # 主脚本：PR 物化（02 §10.2 标准过程）
    worktree.ts                   # worktree 生命周期：create / remove / prune（孤儿清理）
  references/
    pr-facts-contract.md          # pr_prep / current_pr metadata 契约
```

改动既有资产（最小侵入）：

- `development-execution`：Ground 阶段接入 `worktree.ts create`（研发开工建工作树）；步骤 6 PR Preparation 输出按 §3 契约写入 Issue metadata；
- `agents/delivery-lead/` instructions：Materialization 触发段补"调用 pull-request Skill"一句（不内嵌流程）；
- 平台侧：Skill 上传 + skill files upsert + 绑定 Delivery Lead（绑定关系登记进 `agents/delivery-lead/README.md`）。

## 3. PR Preparation Facts 契约（Engineer → Issue metadata）

`development-execution` 收口时由 Engineer Run 写入（02 §10.1 最小输入契约的 metadata 投影）：

| metadata key | 内容 | 写入者 |
|---|---|---|
| `pr_prep` | JSON 数组，逐仓 `{repo_key, source_branch, target_branch, candidate_commit, title, description_ref}` | Engineer（语义内容只有 Engineer 可改） |
| `current_pr` | JSON 数组，逐仓 `{repo_key, pr_id, pr_url, source_branch, target_branch}` | materialize-pr.ts（脚本写回，02 §10.2 "写回 current_pr"） |

规则：

- `description_ref` 为持久可读引用（Issue 评论 ID 或根仓文件路径），不把长文塞 metadata；
- `candidate_commit` 是物化校验锚点：TFS 侧 `branch get` 的 HEAD 必须等于它，不等 → UNKNOWN（02：Branch HEAD != candidate_commit 且原因不明 → 回 Engineer）；
- `title` 脚本原样透传给 tfs-cli，**不改写**（02 §10.1 红线）。

## 4. repo-registry（config/repo-registry.json）

Area Path / 仓 的确定性解析表（语义选仓在 Analyst/Engineer 侧已完成，registry 只做 repo_key → 物理事实的解析）：

```json
{
  "repos_root": "D:/WN_Platform/works/gitee_repos/multica_spec/repos",
  "registry": {
    "df-dataintegration": {
      "tfs_repo": "winning-dps-df-dataintegration",
      "tfs_project": "DP-03-数据采集管理软件",
      "default_target_branch": "master"
    }
  }
}
```

- `repos_root` 下 `<repo_key>/` = 常驻枢纽克隆，`.worktrees/<issue>-<repo_key>/` = 工作树（§3.5 目录约定）；
- 初始只登记现有 4 个 DF 仓；新增仓 = 加 registry 条目 + 枢纽克隆就位（人工一次性动作）；
- `target_branch` 以 `pr_prep` 为准，registry 的 default 只作缺省回填。

## 5. 脚本契约

### 5.1 `materialize-pr.ts`（主脚本）

```bash
node scripts/materialize-pr.ts --issue <issue-id> --config config/repo-registry.json
```

流程（02 §10.2 标准过程的确定性投影）：

```text
读 Issue metadata（pr_prep / tfs.id）
→ 逐仓：registry 解析 → tfs-cli branch get 校验 HEAD == candidate_commit
→ 逐仓：tfs-cli pr list（source+target+active）核对 current_pr
     已存在且字段一致 → 复用登记
     不存在 → tfs-cli pr create（--work-items <tfs.id> 关联）
     current_pr 有记录但外部查无 → UNKNOWN（不擅自重建/不擅自新建）
→ 逐仓写回 current_pr（issue metadata set，幂等）
→ 全部 required 仓登记完成 → issue status in_review（--no-start）
→ stdout: { result: "PASS", prs: [...] }
```

退出码：`0` PASS（全部登记）/ `2` FAIL（明确失败：registry 无条目、pr_prep 缺失/非法、PR 创建被拒）/ `3` UNKNOWN（HEAD 不一致、外部事实冲突、tfs-cli exit 3、身份不可确认）。

### 5.2 `worktree.ts`（生命周期工具）

```bash
node scripts/worktree.ts create --issue <key> --repo <repo_key> --branch feat/<tfs-id> --base <target> --config ...
node scripts/worktree.ts remove --issue <key> --repo <repo_key> --config ...
node scripts/worktree.ts prune  --config ...    # 孤儿清理：.worktrees 下无对应 active Issue 的全部移除
```

- create 幂等：已存在且分支正确 → 复用；已存在但分支不符 → UNKNOWN；
- remove 前校验工作树干净（`git status --porcelain` 非空 → FAIL，不吞未提交工作）；
- prune 供 finalize / 定期维护调用（缺口③接管正式回收时机）。

## 6. 调用链

```text
Delivery Lead 协调 Run
  → 读 Engineer 回流的 Development Evidence + pr_prep
  → delivery-gate 前置检查（既有）
  → 调用 pull-request Skill → materialize-pr.ts
  → PASS：Issue 已 in_review，Lead 汇总结束（等 PR Status Sync / 人工合并）
  → FAIL：按脚本 reason 处理，不绕过
  → UNKNOWN：Lead 语义判断；仅"需改代码/rebase/语义冲突"才重新 @Engineer（02 §10.2 清单）
```

## 7. 验收（全部通过，2026-10-14，测试项 TFS 256462 / Issue FOMA-28）

| # | 用例 | 预期 | 实测 |
|---|---|---|---|
| P1 | worktree create / 重复 create / remove / prune | 幂等复用；脏树 remove → FAIL；孤儿被清 | ✅ create→复用（分支正确）；registry 无条目→exit 2；脏树→exit 2 `reason:dirty`；净树 remove 成功；prune 对活跃 Issue `issue_active` 保留。修复一处：worktree 移除后本地分支残留导致 `-b` 冲突，改为远端/本地引用存在即挂接 |
| P2 | 单仓 materialize 全链路 | PR 建成、挂工作项、current_pr 回写、Issue → in_review | ✅ PR #3339 创建；256462 ArtifactLink 实测确认（PR 侧 workitems 端点 404，走工作项侧关联）；current_pr 回写；Issue → in_review（--no-start） |
| P3 | 重复 materialize | 复用登记，不重建 PR，exit 0 | ✅ 本地登记回核一致路径，`reused:true` |
| P4 | 篡改 candidate_commit（HEAD 不一致） | exit 3 UNKNOWN，不建 PR | ✅ `分支 HEAD(47f4…) != candidate_commit(0000…)，原因待 Lead 判断`，exit 3 |
| P5 | 外部已建 PR、本地 current_pr 缺失 | 复用登记恢复，不重复建 | ✅ 删 current_pr 后重跑，pr list 命中 #3339 复用登记，exit 0 |
| P6 | 多仓 pr_prep（一仓分支不存在） | 逐仓登记；单仓 FAIL 不中断其余仓，整体 exit 2 | ✅ df-dataintegration 复用成功 + df-metadata-web `source_branch_not_found`，exit 2；FAIL 时 current_pr 未被部分回写 |

测试纪律执行：PR #3339 已 abandon、远端/本地分支 feat/256462 已删、worktree 已回收、FOMA-28 测试 metadata（pr_prep/current_pr）已清、状态复位 backlog。

实现期偏差记录（相对 §5 契约，均为加固）：

- materialize-pr.ts 增加"本地已登记先回核"前置（§5.1 流程图的第 0 步）：`current_pr` 有记录时先 `pr get` 回核——非 active / 外部查无 / 分支事实不符 → UNKNOWN 交 Lead，**不擅自重建**（02 §10.2 幂等纪律的完整投影，P3 实测覆盖）；
- Node 24 直跑限制：constructor parameter property 非可擦除语法，已改为显式字段声明（红线 1 的实测约束，后续脚本一律遵守）。

## 8. 明确不做

- PR 评审过程读取/投票、合并动作（02 §63：审核留在 TFS 平台；合并是人工动作）；
- PR 状态轮询与 finalize 触发（缺口⑥ PR Status Sync Agent）；
- OpenSpec Archive / TFS 回写 / Issue 关闭（缺口③ finalize-delivery）；
- rebase / 冲突解决 / 任何代码改动（回 Engineer，02 §10.2 清单）；
- TFVC 仓支持。

## 9. 开放问题

1. **分支命名**：`feat/<tfs-id>`（§3.5 定稿）vs 业务仓现行惯例（实测见 `bugfix/255918-rc`）——按 §3.5 执行，目标分支由 pr_prep 指定（如 `rc`），命名不追旧例；
2. **pr_prep 的 description_ref 载体**：首选 Issue 评论（平台内持久可读），待 P2 实测确认 Engineer 写入与脚本读取的完整链路；
3. **多 Issue 同仓并行**：§3.4 Lead 放单判定 + worktree 隔离已覆盖；同 target branch 的 PR 排队合并语义属 TFS 侧人工流程，本 capability 不管控。
