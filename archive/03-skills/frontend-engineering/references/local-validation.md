# Frontend Local Validation 命令映射（DF 业务仓实测）

> **本文件为前端本地验证命令映射的唯一权威**（对应 04 §7.2 必做检查类型与 §7.4 Evidence 五问）。本表提供**命令映射**；填不出的项标 UNKNOWN，不虚构。语义背景：04（根级现行版 `projects/multica/04-engineer-development-design.md`）。
> 实测日期：2026-10-15；实测对象：历史键 `df-dataintegration-web`、`df-metadata-web`、`df-dataasset-web`（当时位于 `repos/`，枢纽克隆只读探查）。当前仅 `df-dataintegration-web` 明确对应 `repo_id = dataintegration-web`（`repo_path = winning-dps-df-dataintegration-web`）；其余历史键不在当前 repo-context 中，不自动映射。现行路径为 `<root_repo>/<repo_path>`。

## 工具链事实（三个 web 仓同构）

- Vue 2（^2.6.x）+ vue-cli-service + babel；无 TypeScript（无 tsconfig.json）；
- `package.json` scripts（三仓一致）：`serve` / `build` / `WXPserve` / `WXPbuild` / `lint`；
- **无单元测试框架**（无 jest / 无 `test` script）；依赖安装为 npm（仓内无 lock 文件形态差异需以实际为准）。

## 检查类型 → 命令映射（在业务仓枢纽克隆根执行）

| 04 §7.2 检查类型 | 命令 | 说明 |
|---|---|---|
| Build / Compile | `npm run build` | 即 `vue-cli-service build --mode prod`；Node ≥17 环境按下方「Node 版本与 OpenSSL 兼容」前置处置 |
| Lint / Static Check | `npx eslint <改动文件>` | 判定按下方「Lint 基线债判定规则」；**不执行全仓 `npm run lint`** |
| Targeted Test | UNKNOWN——仓内无测试运行器 | 行为验证走浏览器观察（见 feedback-signals），不虚构 |
| Relevant Regression | UNKNOWN——同上 | 受影响页面的浏览器抽查 + 既有 Lint/Build PASS |
| Runtime / Contract Check | `npm run serve` 起本地开发服务器后人工/浏览器验证 | 任务声明的运行时验收按此路径；接口契约核对依赖后端联调环境 |

## Node 版本与 OpenSSL 兼容（2026-11-03 增补）

- 此类 Vue 2 + webpack 4 仓在 **Node ≥17** 下执行 `npm run build` 必现 `error:0308010C: digital envelope routines::unsupported`（OpenSSL 3 与 webpack 4 的 md4 hash 不兼容）。这是工具链事实，不是代码缺陷，不得转向诊断源码。
- **统一处置**：仅当 `node -v` 主版本 ≥17 时，构建/验证命令前置 `NODE_OPTIONS=--openssl-legacy-provider`（POSIX shell / bash 形态；cmd、PowerShell 形态不同，agent 运行时均走 bash）：

  ```bash
  NODE_OPTIONS=--openssl-legacy-provider npm run build
  ```

  2026-11-03 实测 Node 22 / 24 有效。该选项 Node 17 才引入；**Node ≤16 视为未知选项、进程启动即失败，无需且不可加**。
- 备选：切 Node 16 执行。按当前运行时解析可用版本管理器，**契约不写机器路径**（生产 daemon 无 nvm，单机路径对其他运行时无效）。
- 适用范围：datamodel-web 经 WNDF-43 Run（2026-10-29）实证；其余 DF web 仓按同构推断，首跑验证后回填本表。

## Lint 基线债判定规则（2026-11-03 增补）

- 仓内存在全仓级既有 lint 债务（datamodel-web 全仓 `npm run lint` 实测 ~838 errors，2026-10-29）。**全仓 lint 结果不作为判定依据，不执行全仓 `npm run lint`**。
- 只对**本次改动文件**执行 `npx eslint <改动文件>`；仅 `git diff` 触及行上的**新增**错误判 FAIL，文件内既有错误忽略。
- 不做 stash / 临时检出对比来自证「债是既有的」——建立改动前基线属被禁止行为；既有债不判 FAIL，亦无需证明。

## 验证深度分级（2026-11-03 增补）

- **纯展示/隐藏类变更**（仅模板/样式增删，不改交互逻辑、事件与数据流）：开发侧 Required Verification = 改动文件 lint + `npm run build` + 受影响代码的代码级回归核对；页面人工核查属 Human 验收环节，Engineer 不起浏览器 / `npm run serve` 环境。
- **行为逻辑变更**（事件、数据流、接口交互有实质变化）：行为与回归验证按上表走浏览器观察路径。
- 无法判定归属时按行为逻辑变更处理，不自行降档。

## Evidence 五问（04 §7.4，每项 Required Verification 必须可回答）

1. 依据哪个 `task_ref`、Requirement / Scenario 或 Corrective Expected / Regression Scope？
2. 对哪个 Repository Candidate / Contract / Environment 执行？
3. 实际采用什么命令、浏览器操作、运行记录或其他可复核方法？
4. 结果 PASS / FAIL / UNKNOWN 的证据位置和失败限制是什么？
5. 如果复用既有 Evidence，为什么它对当前 Candidate 与 Contract 仍有效？

## 纪律

- Windows 下跨 shell（PowerShell/cmd）传构建参数时的引号纪律（`-D` 类参数单引号包裹、不拼长组合表达式）见 `backend-engineering/references/local-validation.md` 的「Windows 构建/格式化调用纪律（RLL-5 实测固化）」；本仓命令均走 bash，不直接适用其 Maven 细节。
- 存在无法执行的 required check 时，**不得隐式视为 PASS**：按已批准 Contract 判 BLOCKED / UNKNOWN 并升级（04 §7.2）；
- 浏览器行为验证记录操作步骤、路由、观察点与截图/记录引用；
- 记录检查名称、实际命令、退出码、关键输出位置、Candidate Commit、适用范围与失败说明；
- 命令随仓演进失效时更新本表。
