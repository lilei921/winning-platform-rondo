# Backend Local Validation 命令映射（DF 业务仓实测）

> **本文件为后端本地验证命令映射的唯一权威**（对应 04 §7.2 必做检查类型与 §7.4 Evidence 五问）。本表提供**命令映射**；填不出的项标 UNKNOWN，不虚构。语义背景：04（根级现行版 `projects/multica/04-engineer-development-design.md`）。
> 实测日期：2026-10-15；实测对象：历史键 `df-dataintegration`（当时路径 `repos/df-dataintegration`，枢纽克隆只读探查）。该仓当前 `repo_id = dataintegration`，`repo_path = winning-dps-df-dataintegration`；现行路径为 `<root_repo>/<repo_path>`，不再使用 `repos/`。

## 工具链事实（dataintegration，历史键 df-dataintegration）

- Maven 多模块（父 POM packaging=pom），Java 8（`<java.version>1.8</java.version>`）；
- 仓内带 Maven Wrapper：`mvnw` / `mvnw.cmd`（Windows 用 `mvnw.cmd`）；
- JUnit 依赖存在于 `datasource-greenplum`、`task-df`、`task-http` 等模块（测试基础设施可用，但非全模块有测试）。

## 检查类型 → 命令映射

| 04 §7.2 检查类型 | 命令（在业务仓枢纽克隆根执行） | 说明 |
|---|---|---|
| Build / Compile | `./mvnw -q compile -DskipTests`（全量）或 `./mvnw -q -pl <module> -am compile -DskipTests`（定向） | 定向编译大幅省时；`-am` 带依赖模块 |
| Targeted Test | `./mvnw -pl <module> test -Dtest=<TestClass>` | 模块无测试时改用备选 Signal（见 feedback-signals） |
| Relevant Regression | `./mvnw -pl <module> -am test` | 按变更风险扩大范围（04 §7.2 允许先窄后宽） |
| Lint / Static Check | Spotless 格式化：`mvn -o -B -pl <module> spotless:check '-DspotlessFiles=.*<类名>[.]java'`（调用纪律见下节） | 2026-10-15 全仓调查时未见强制插件；RLL-5（2026-11-05）实测 pom 已配置 spotless-maven-plugin 2.27.2（`-Dspotless.skip=true` / `-Pskip-spotless` 可跳过） |
| Runtime / Contract Check | UNKNOWN——需任务级声明（如 API 契约测试的运行方式） | 按 `task_refs` 声明的验证方式执行 |

## Windows 构建/格式化调用纪律（RLL-5 实测固化，2026-11-05）

> 来源：RLL-5 回放 Backend session 16:17–16:27 连续试错实录（`projects/replay/20261106-RLL-5-multica/sessions/20261105-1542-01a1aaa8/replay.md`）。
> 本节固化**已验证可用**的参数形态，禁止重新试错。

### spotlessFiles 是 regex，不是 glob

- `-DspotlessFiles=**/EtlTextWriteBoundaryTest.java` → `Dangling meta character '*' near index 0`（glob 写法必败）。
- 正确形态：`-DspotlessFiles=.*<类名>[.]java`（`.*` 前缀 + `[.]` 转义点号）。

### PowerShell / cmd 引号传递

- PowerShell 下 `-D` 参数用**单引号**包裹：`'-DspotlessFiles=.*X[.]java'`。
- cmd /c 双引号下传长 alternation（`.*(A|B|C…)`）实测被拆坏（引号残留报错）；多文件**不要**拼单条组合表达式。

### 逐文件 vs 单批的选择

- 单文件：`mvn -o -B -pl <module> spotless:apply '-DspotlessFiles=.*<类名>[.]java'`（实测 OK）。
- 多文件：PowerShell 循环逐文件执行（实测 OK）：

  ```powershell
  foreach ($c in @('ClassA','ClassB')) { mvn -o -B -pl <module> spotless:apply "-DspotlessFiles=.*$c[.]java" }
  ```

- 定向测试（实测 OK，单引号传 `-D`）：

  ```powershell
  mvn -B -pl <module> test '-Dtest=<TestClass>' '-Dsurefire.failIfNoSpecifiedTests=false' '-Dspotless.skip=true' '-Djacoco.skip=true'
  ```

## Evidence 五问（04 §7.4，每项 Required Verification 必须可回答）

1. 依据哪个 `task_ref`、Requirement / Scenario 或 Corrective Expected / Regression Scope？
2. 对哪个 Repository Candidate / Contract / Environment 执行？
3. 实际采用什么命令、测试、运行记录或其他可复核方法？
4. 结果 PASS / FAIL / UNKNOWN 的证据位置和失败限制是什么？
5. 如果复用既有 Evidence，为什么它对当前 Candidate 与 Contract 仍有效？

## 纪律

- 存在无法执行的 required check 时，**不得隐式视为 PASS**：按已批准 Contract 判 BLOCKED / UNKNOWN 并升级（04 §7.2）；
- 记录检查名称、实际命令、退出码、关键输出位置、Candidate Commit、适用范围与失败说明；
- 命令随仓演进失效时，更新本表（同步改三份 repo-registry 无关，本表仅此一份）。
