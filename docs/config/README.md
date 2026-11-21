---
title: 仓库配置说明
version: 1.0.0
status: active
created_at: 2026-10-20
updated_at: 2026-10-20
owner: winning\li_lei
---

# 仓库配置说明

本目录维护全量仓库清单和本地工作区使用的仓库配置。

| 文件 | 用途 | 范围 |
| --- | --- | --- |
| [repo-context.yaml.example](./repo-context.yaml.example) | 所有已接入子仓的全量清单，虽然使用 `.example` 后缀，但保存真实仓库信息 | 全量已接入仓库 |
| [repo-context.yaml](./repo-context.yaml) | 本地工作区运行时使用的注册表，主要登记本地已经存在的子仓 | 全量清单的子集 |

两份文件均包含 `root` 条目，用于描述根工作区自身；其余条目描述子仓。两份文件使用相同的 `version` 和 `schema`，以 `repo_id` 对应同一个仓库。

## 两份文件的关系

- `repo-context.yaml` 中的每个仓库都应出现在 `repo-context.yaml.example` 中。
- 同一仓库的路径、职责、关键词、边界和 TFS 归属保持一致；两份文件的仓库排列顺序可以不同。
- 全量清单中的仓库不一定存在于当前机器。本地没有选入某个仓库，不代表该仓库未接入。
- 工具和 Agent 在当前工作区使用 `repo-context.yaml`；不会自动合并或回退到 `.example`。
- 本地配置主要反映已检出的仓库，但目录可能被移动或删除。实际检出状态仍由 `tools/repo_registry.py` 查询磁盘后返回，不在 YAML 中保存 `repo_status`。

## 维护与同步

1. **新增接入仓库**：在全量清单登记；当前机器已有该仓库且需要使用时，同时加入本地配置。
2. **配置本地工作区**：从全量清单按需选择条目，确认路径后写入本地配置，保留 `root`；不要直接用全量文件覆盖本地文件。本地配置已加入 Git 忽略，新检出工作区需自行创建。
3. **修改本地条目**：按 `repo_id` 将最新条目完整同步到全量清单，保留全量清单中本地未选入的仓库。
4. **修改全量清单**：如果本地已选入该仓库，同步更新对应条目。
5. **移出本地范围**：仅从本地配置移除，不据此删除全量清单中的条目。仓库正式退出接入范围时，再核实并调整两份文件。

同步是按仓库身份合并条目，不是覆盖整个文件；同一 `repo_id` 不重复追加。修改 `version` 或 `schema` 时同步两份文件。

## 字段与验证

必填字段为 `repo_id`、`repo_type`、`repo_path`、`responsibility`、`keywords`、`not_responsible_for`；`repo_url`、`tfs_project` 和 `tfs_collection` 可选，具体结构见文件内的 `schema`。`repo_url` 对只读仓库目录查询可缺省，但 `rondo dev prepare` 必须取得并校验该字段；未知 URL 保持缺省，不猜测填充。`repo_url` 为仓库的 TFS origin 地址，本地已检出仓库按 `git remote get-url origin` 逐字登记，未检出仓库按 `tfs_collection`/`tfs_project`/`repo_path` 推导并用 `git ls-remote` 验证后登记。

首次检出时，可先运行 `Copy-Item docs/config/repo-context.yaml.example docs/config/repo-context.yaml`，再删除本地不需要的仓库条目，保留 `root`。此文件只保存在当前机器；Git 继续跟踪全量清单。

在工作区根目录执行：

```powershell
# 查看本地已登记且实际存在的仓库。
python tools/repo_registry.py list --present-only

# 查询单个仓库的路径与当前检出状态。
python tools/repo_registry.py resolve <repo_id-or-path>

# 校验两份配置的核心结构、身份唯一性及查询行为。
python -m pytest tests/test_repo_registry.py -q
```

同步完成后，还应核对本地仓库集合是全量清单的子集、共同条目内容一致，以及全量清单中的其他条目未被删除。

构建、测试与技术栈到目标仓核实；页面、接口及跨服务入口见[路由总览](../router/overview.md)。旧风险与依赖保留在[历史迁移快照](../../projects/analysis/repo-context-retired-metadata-2026-10-20.yaml)，仅供追溯，不作为当前事实。
