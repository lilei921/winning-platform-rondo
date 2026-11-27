# rondo-sync 支持 Project Resource Label 供给方案

日期：2026-11-27  
基线：`dev` @ 37a4af9（含 `docs/config/project-resources.yaml` 未提交修改，方案只读取、不改写该文件）  
状态：方案已确认，待实施

## 1. 目标与已确认决策

在 rondo-sync 中新增一个默认步骤：读取 `docs/config/project-resources.yaml` 的 `label`，按仓库 URL 设置到**目标 workspace 的当前 Project 的仓库 Resource** 上，并回读校验。

| 决策点 | 结论 |
|---|---|
| 作用范围 | 全部同步目标 workspace（沿用 `--member` / `--prefix` / 位置参数发现口径，按分组 Project 标题定位项目）；脚本也支持单独指定 workspace 执行 |
| 更新策略 | 全量对齐 YAML：匹配资源的 `label` 与 YAML 不一致就更新，含覆盖已有手写 label |
| 集成方式 | 接入主同步流水线为默认步骤，支持 `--skip-resource-labels`；`check_workspaces.py` 增加一致性校验；SKILL.md 同步文档 |

不做什么（KISS / 边界）：

- 不新增、删除 Resource；不修改 `ref`、`default_branch_hint`、`position` 等字段。
- 不修改 `project-resources.yaml`、`repo-context.yaml`、manifest 或任何仓内 overlay。
- 不把业务语义知识搬进 label（与 `19-repository-context-resource-simplification-plan.md` 一致）；label 是本仓库清单的确定性摘要，语义知识仍以 codebase-explorer 的 Markdown 为准。
- 不覆盖非 `github_repo` 类型、URL 未命中 YAML 的 Resource。

## 2. 现状事实

- `multica project resource update <project-id> <resource-id> --label <label>` 是现成原生命令，无需改 Rondo。
- `multica project resource list <project-id> --output json` 返回 `id`、`resource_type`、`resource_ref.url`、`label`；当前 winning-lilei / winning-platform-monorepo 项目有 5 个 `github_repo` 资源，其中 4 个 `label: null`，1 个已有手写长 label（需被 YAML 值覆盖）。
- Project 定位口径已存在：`check_workspaces.py:104` 合并 `provisioning.json` 顶层 `project.title` 与 `workspace_groups.<组>.project.title`，再按标题在 `multica project list` 中精确匹配；分组解析复用 `provision_workspace_repos.py:66` 的 `resolve_group()` 模式。
- workspace 定向：`MULTICA_WORKSPACE_ID=<id>` 环境变量（与 `provision_workspace_repos.py` 一致）；只读命令走 `cli_retry.run_cli(..., transient=True)`，写命令不重试。
- Python ≥ 3.7 + PyYAML 已是 skill 前置条件，无需新增依赖。

## 3. 新脚本：`provision_project_resource_labels.py`

路径：`.claude/skills/rondo-sync/scripts/provision_project_resource_labels.py`

```text
python provision_project_resource_labels.py [workspace] [--workspace-id <uuid>]
    [--repo-root <path>] [--dry-run]
# 默认 workspace 沿用现有脚本的 winning-admin
```

流程：

1. `find_repo_root()` 定位仓库根（与现有脚本一致，路径不明时要求 `--repo-root`）。
2. 解析目标 workspace：`multica workspace list --output json` → `(workspace_id, slug)`。
3. 从 `provisioning.json` 按 slug 解析分组，合并得到 `project.title`；在目标 workspace 内 `multica project list --output json` 按标题精确匹配。找不到项目 → `[FAIL]` + 退出码 1（不创建项目，由 provision 步骤负责）。
4. 读取 `docs/config/project-resources.yaml`（`yaml.safe_load`，UTF-8）：校验 `repos[]` 每项有非空 `repo_url` / `label`，构建 `repo_url -> label` 映射；重复 URL 且 label 不同 → 报错停止，避免歧义。缺文件或 YAML 非法 → 明确报错退出。
5. `multica project resource list <project-id> --output json`，逐条处理：
   - 仅 `resource_type == "github_repo"` 且 `resource_ref.url` 与 YAML `repo_url` **精确相等**（仅做首尾空白 / 尾部 `/` 归一化，不做模糊或仓库名匹配）才视为命中；
   - `label` 相同（含双方均为空）→ `[SKIP]`；
   - 不同 → `--dry-run` 打 `[DRY ]`，否则执行 `multica project resource update <project-id> <resource-id> --label <label>`（env 带 `MULTICA_WORKSPACE_ID`，写命令不重试）；
   - 未命中或非仓库类型 → `[INFO]` 说明不处理；不新增 Resource。
6. 有写入时，写完后重新 `resource list` 回读一次，逐条确认 label 生效；打印 `[OK]` / `[FAIL]`，结尾统计 `跳过/已更新/失败`，有失败退出码 1。
7. 输出中不打印凭据；label 文本可打印（仓库清单公开信息）。

供 check 复用的纯函数（保持单一解析口径）：

- `load_label_map(root: Path) -> dict[str, str]`
- `resource_url(resource: dict) -> str | None`

## 4. 接入主同步与校验

### `sync_workspace.py`

- 文档串新增步骤 `6. resource-labels`，用法新增 `--skip-resource-labels`。
- `main()` 新增 `--skip-resource-labels` 开关；解析脚本路径，未跳过但脚本缺失则前置停止（同 `repos_script` 处理）。
- 将 `labels_script` / `skip_resource_labels` 传入 `sync_workspace()`；在「供给 workspace 仓库注册表」之后追加一步：
  `[sys.executable, labels_script, name]`，`--dry-run` 时透传；跳过时打印 `[SKIP]`。
- 该步骤失败按现有 per-workspace 失败语义计失败数，其余 workspace 继续。

### `check_workspaces.py`

- `main()` 通过新脚本的 `load_label_map(root)` 读取 YAML（复用同一路径与校验规则），传给 `check_workspace()`。
- 在 Project 维度之后新增维度「Project Resource label」：
  - 对目标 Project 的资源按同一 URL 匹配规则比对 label：全部一致 → `[OK]`；不一致 → `[FAIL]`（列出仓库名，不打印完整 label 文本以免刷屏）；
  - YAML 中声明但 Project 未挂载的仓库不报 FAIL（脚本本就不新增 Resource，可选 `[INFO]`）；
  - YAML 读取失败 → `[ERROR]`，计入该 workspace 失败。
- `SKILL.md` 的「状态校验」维度清单与分级语义同步补充该维度。

### `SKILL.md`（版本 1.8.0 → 1.9.0）

- description / 何时使用：补充「按仓库清单设置 Project Resource label」。
- 前置条件：明确 PyYAML 与 `docs/config/project-resources.yaml` 为可选输入（缺文件时该步骤报错停止，不影响 `--skip-resource-labels`）。
- 参数表新增 `--skip-resource-labels`；执行步骤新增第 6 步；新增「Project Resource label 供给」小节（匹配规则、全量对齐、不增不删、只读回读、权限要求同 `repo add` / `workspace mcp add`）。
- 校验清单与边界小节补充 label 口径。

## 5. 测试与验收

- 新增 `tests/test_project_resource_labels.py`（沿用 `tests/test_workspace_sync.py` 的临时目录 + mock CLI 风格，不连真实平台）：
  1. YAML 解析/重复 URL 报错；
  2. URL 命中与 label 相同 → 不写；
  3. label 不同 → 发 `project resource update ... --label ...`，回读一致 → `[OK]`；
  4. `--dry-run` 不写；
  5. 非 `github_repo` / URL 未命中不处理；
  6. 项目未找到 → 退出码 1。
- 在 `tests/test_workspace_sync.py` 补一条断言：新增步骤按参数加入/跳过流水线（可选，最小充分）。
- 本地验证：
  ```powershell
  python -X utf8 -m unittest discover -s .claude/skills/rondo-sync/tests
  cd rondo
  npm run build
  node --test test/workspace-root-layout.test.mjs test/workspace-environment.test.mjs test/workspace-mcp.test.mjs test/d1-analysis-skills.test.mjs dist/clients/required-statuses.test.js
  ```
- 真实验收（需用户授权后才执行写操作）：
  ```powershell
  python .claude/skills/rondo-sync/scripts/provision_project_resource_labels.py winning-lilei --dry-run
  python .claude/skills/rondo-sync/scripts/check_workspaces.py winning-lilei
  ```
  预期：当前项目 5 个匹配资源中，4 个空 label 被填充，1 个手写 label 被 YAML 值覆盖；`check` 无新增 `[FAIL]`。

## 6. 实施顺序

1. 新脚本 + 单测（独立可跑，`--dry-run` 先行验证）。
2. 接入 `sync_workspace.py` + 参数/文档。
3. `check_workspaces.py` 校验维度 + SKILL.md 文档更新。
4. 跑本地回归； dry-run 输出给用户确认后，再按指定 workspace 真正执行同步。
