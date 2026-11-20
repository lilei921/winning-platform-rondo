# 08-A 本地实施与验证记录（2026-11-14）

本文件保留首轮实施的历史证据。后续 Python schema 修复、TT-5 / TT-6 真实 Runtime 与隔离 Bug E2E 的新增结果见 [后续验收记录](08a-runtime/README.md)；下文原有两项 Python 失败及未执行状态不代表后续结果。

**范围：共享基础与独立 Bug Fix。08-B Requirement 专属改造继续暂缓。** 本记录区分源码实现、本地隔离测试、控制端只读协议验证和真实 Runtime / E2E；不改变 M10 的历史 PASS 或跨机器 NOT_RUN。

结束核对时根仓 HEAD 为 `88233765a8bde05dd540ff3381bd6d7cb49d8207`（其父为用户给定文档基线 `8799d591`）；该配置提交来自并行工作，本任务未执行根仓提交或推送。

## 实现

- `rondo runtime check-checkout`：只读核验当前 Task / Actor / Workspace、Issue 指派、Project Resource 与 manifest，以及平台 `work_dir` 下原生根仓的路径和 origin。未知事实返回 UNKNOWN，明确身份不符返回 FAIL；不 checkout 根仓、不调用 Bootstrap。
- `rondo dev prepare`：先核验 Task 和 Bug 授权，再准备单个已登记业务仓。Registry 透传 `repo_url`；核对 TFS Collection / Project / Repository、目标分支、根仓忽略与跟踪边界、独立 Git root、origin 和分支归属。缺仓 clone 后建立 `feat/<tfs.id>`，已有远端同 Bug 分支可接续；已有同分支保留 dirty / unpushed，不自动 fetch、reset、stash、rebase 或 clean。
- Git 与认证：共享兼容 Git 程序和子进程 PATH，认证限定精确 TFS 仓库 URL，关闭重定向、交互和 Trace，拒绝 URL rewrite，输出脱敏。旧 Requirement Archive 继续经原入口调用该共享实现；固定 `analysis.source.commit` 与 Archive 契约不变。
- `bug prepare-pr` 接入同一原生根仓 / 业务仓身份核验及受控远端读取。新增窄入口 `rondo bug git --operation fetch|push`，供后续操作使用同一授权、工具与认证；只 fetch 目标远端引用或非强制 push 当前候选 HEAD，不接受任意 Git argv。prepare 本身不 push。
- TFS Writeback：评论正文附加 Issue / TFS / Change / PR 的稳定交付引用。完成标记缺失时先完整分页回读已有 History，只补未完成动作。旧格式评论无法确定归属时 UNKNOWN；查询失败不发布。没有新增 Metadata 字段或状态机。
- Complete：Bug / Requirement 共用摘要正文认领；已有本次摘要直接复用，确认没有才发布。缺失 ID 或保存 ID 失败后的恢复不要求补存 ID；旧交付摘要不能替代当前摘要。
- 同步 Wayfinder / Bug Agent、`codebase-explorer`、`bug-delivery`、`finalize-delivery` 和 08 设计/待验文档。研发手动 todo 与目标态自动 todo 的约定保持原样。

## 核实的外部事实（只读）

| 对象 | 本轮观察 | 结论边界 |
| --- | --- | --- |
| 历史 TEST-5 Run | `issue runs` 返回 `id=01a1d2fc-da3a-796b-9584-f8f23e188c07`，含 issue_id、agent_id、workspace_id、work_dir；Task 文件有 daemon context 和 Project manifest | 确认字段和已观察的原生布局，不是新实现的真实 Agent 验收 |
| Project Resource | Project `d43bbc9d-4cc2-4cee-8f92-70c993ffbf97` 在线列表为数组，根仓 Resource `eee149cc-9c37-415c-a1d8-b0c3b3b56585`、ref=main，与历史 manifest 匹配 | 无资源修改或主动 checkout |
| TFS 260986 | GET item / updates：rev=6、7 条 update、1 条 History；update 2/3 共用 rev=2 | TFS 2018 关系更新可复用 rev；读取器以连续 update.id 分页，并核对查询前后 revision。修正后完整读取成功；没有追加评论或改状态 |
| frame Git | Registry 的 repo_url + delivery.frame.default_target_branch=dev；兼容 MinGit 调用共享认证 `ls-remote` 成功，HEAD `0a2857e17d2a146a6c0b5440a993a3acfc9b9473` | 仅控制端只读认证验证，未 clone/fetch/push 真实业务仓；不能替代 Task Runtime 验收 |
| Remote filesystem | `list_allowed_directories` 返回 `/root/workspace/winning-platform-monorepo` | 仅发现授权根目录，不等于三个 MCP 主路径或越界权限验收 |

未新建 Run、Issue、PR、工作项或生产评论；没有发布 Agent/Skill、全局安装 Rondo、提交或推送代码。未编辑用户指定的两份无关配置；途中发现的其他并行配置变更也未覆盖。

## 本地验证

构建和 Node 测试在 `tools/rondo` 执行：

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| `npm run build` | PASS，TypeScript 无错误 | 与最终测试使用同一固定构建 |
| `npm test` | **414 PASS、3 SKIP、0 FAIL**，共 417 项，380.6 秒 | [完整日志](08a-local-validation/rondo-final-regression.log)；SKIP 为已有链接/现场只读环境用例，不计通过 |
| `python -m pytest tests/test_repo_registry.py -q` | **24 PASS、2 FAIL** | [完整日志](08a-local-validation/python-registry.log)，既有 schema 断言失配见下文 |
| 三个 Skill 的 `quick_validate.py` | PASS | Windows 以 `python -X utf8` 执行；默认 GBK 读取失败后改为 UTF-8，未改文档编码 |
| 三个 Skill 的 `validateSkillReferences` | PASS，均为 0 problems | bug-delivery / codebase-explorer / finalize-delivery |
| `git diff --check` | PASS | 无差异格式错误；Git 提示 CRLF 将归一为 LF，不影响结果 |

新增测试与完整回归重叠，数量不累加。前期失败日志保留在本机 `tools/rondo/build/08a-validation/`，最终证据见上表。

本次新增测试覆盖真实 `dev prepare` CLI（平台 API 为本地 fixture）、实际独立 Git checkout、首次 clone、远端候选接续、dirty / unpushed 保留、错误分支/origin、路径/junction、clone 中断与重试、Task / Actor / Resource、来源 URL、Scope、Registry URL 投影、摘要发布后 ID 保存失败、Bug/Requirement 评论成功后标记保存失败，以及查询失败和 History 分页不完整。

前期失败与修正：

1. 沙箱普通 Git 的 MSYS 命名对象创建失败；兼容 MinGit 配合子进程 PATH 后，工作区内临时 fixture 的 Git 操作通过。沙箱禁止 junction 创建；完整隔离测试经执行权限检查运行，没有用此结果宣称真实 Multica 沙箱已适配。
2. 控制端真实 GET 揭示 TFS update.id 与 rev 并非一一对应，已修正读取器及测试。第一轮完整回归后段的 7 项失败发生在旧 fixture 与更新后的读取器混用时；补齐 fixture 的 update.id 后对固定构建重新执行完整回归。
3. `python -m pytest tests/test_repo_registry.py -q`：24 PASS、2 FAIL。两项失败均为既有 `test_registry_files_have_complete_unambiguous_core_records`：其 CORE_FIELDS 仍未包含 YAML 已声明的 repo_url。新增 URL 投影/未检出仓库测试通过。另发现 `.example` 中 WiNEX-IP 等旧条目没有 repo_url，未猜测 URL 或扩展本次配置修改；缺 URL 的 Registry 项不能被 prepare 放行。

## 代码自审与限制

本轮完成源码自审，重点核对：先授权后 Git 副作用、原生根仓独立性、路径和链接边界、业务 origin/push URL、目标分支、凭据作用域、dirty 保留、部分成功恢复、Requirement 旧契约兼容以及没有新增外部写入。已补充根仓禁止作为业务仓、目标分支合法性、继承 Git 定位变量清理和来源 URL 校验。这是本轮自审，不标为独立评审 Agent 的结论。

当前实现只支持已观察的 `work_dir/winning-platform-monorepo` 独立 checkout；其他原生布局、未运行 Task 或不完整上下文安全停止。支持默认候选 `feat/<tfs.id>`；已有自定义候选仅由 prepare-pr 旧参数路径核验，不由 prepare/git 自动迁移。未确认的 clone 现场保留，不能自动清理。

## 未完成的集成验收

08A-V01～V08、08-F02 的真实 Runtime、08-F03 独立机器接续继续 **NOT_RUN**。本轮没有新的指定 Bug 测试对象及生产外部写入授权，也没有第二台机器执行条件；不复用 M10 的历史测试授权。平台工具/凭据的真实 Task 注入、Wayfinder 两类来源唯一交接、三个 MCP 的正常调查与权限边界、真实业务 clone/fetch/push/PR、无原工作区 Bug Finalize 均须后续验收。

PR Status Sync 无 Project、并发为 1 的既有配置结论保留；没有新增并发仲裁、锁或专项并发验收。M10 仅证明原契约下跨 Runtime 顺序接续，未扩大为跨机器或独立 Bug 完整 E2E。
