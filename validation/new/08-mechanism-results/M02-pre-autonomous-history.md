# M02 — 二级独立 Git 仓与 Workdir 生命周期：2026-11-13 重验

- 整体机制状态：**PASS（外部 fixture 支持下的二级仓与生命周期 PoC）**；不等于当前 Runtime 的自主准备验收通过。
- 当前 Runtime 自主本地 clone：**FAIL**，两次实际调用均触发 Windows/MSYS 访问拒绝；后续使用控制端外部 fixture 支持。
- Rondo dev prepare 命令验收：**NOT_RUN**。本轮没有执行该命令，不能把前置 Git clone 失败写成已执行该命令的结果。
- 对应：08 v0.9 §6.3 / V05、V10。环境与根仓身份见 [M01](M01.md)。

## 测试对象与边界

| 对象 | 身份 |
| --- | --- |
| Run A2 | TEST-5 / Task 01a1d2fc-da3a-796b-9584-f8f23e188c07 |
| Run B | TEST-6 / Task 01a1d30c-a957-7a02-883e-b569fc44cf1b |
| root HEAD | dfdaf33fa58355332259524266045d1052ef9dea |
| 子仓逻辑路径 | 当前 Task 根仓 registry 的 common.repo_path：winning-dps-df-common |
| 测试 child / bare / seed Commit | 828d42779530b781c4b65bc0e1a6ad7b811eb0a8 |
| child origin | A2 workdir/validation-fixture/M02-local-fixture.git，本机一次性 fixture |

真实 common.repo_url 只从 registry 读取并记录，不用于本轮 clone；没有真实业务仓认证或业务 Commit 发布验证。只有一份本地 fixture，没有把 child 注册为第二个 Multica Project Resource。

## 已执行证据

1. M01 提供真实原生 root 路径后，读取该 checkout 的 .gitignore 与 registry；目标为不存在的直接子目录，无 reparse point。git check-ignore 命中 .gitignore 第 8 行 /winning-dps-df-*/，未修改忽略规则。
2. Task 创建本地 seed，提交一份 README.txt。普通 clone --bare 与显式 --local --no-hardlinks clone 均 exit 128，错误为 MSYS NtCreateDirectoryObject / 0xC0000022；child 尚未创建。两次失败都保留。
3. Task 的审批策略为 never，不支持发起提权；没有自动审批拒绝。控制端通过自身获批的沙箱外工具，在同一个可废弃 Task 目录完成本地 bare 和 child clone，两次 exit 0，根仓前后 status 均为空。没有远端访问或写入。详见[外部支持命令证据](M02-controller-fixture-support.json)。
4. 真实 Task 独立回读 seed / bare / child 身份，核对同一 Commit、两个独立 Git top-level、各自 .git/common-dir 与 origin；根仓不跟踪 child 源码。
5. Task 修改 child 的 README.txt 并创建未跟踪标记，记录 diff、status 和 Hash。根仓 status 仍为空。
6. 真实 Task 执行普通 root checkout 重入，11:54:33.546 → 11:54:37.834，exit 0。root/child 的路径、HEAD、分支、origin、status 和两类改动 Hash 全部保留。registry 与 .gitignore Hash 不变。
7. TEST-6 两次原生 checkout 均 exit 0，root 与 A2 路径及 common-dir 独立；新 Task 未自动出现 child，重入后仍不存在。控制端以只读 Git 命令和 Hash 对照 A2 的 before/after，root/child 身份、状态、两类标记 Hash 完全相同。

原始证据：[A2 JSON](M01-M02-rerun-A2-evidence.json)、[A2 交接数据](M01-M02-rerun-A2-handoff.json)、[A2 before 快照](M02-A2-before-B-snapshot.json)。Task 原始记录中早期 NOT_RUN/FAIL 条目是按时间保留的历史状态；同 Task 恢复后的断言和最终状态另列，不能只统计全文件的旧状态数量。

跨 Run 证据：[B JSON](M01-M02-rerun-B-evidence.json)、[A2 after 快照](M02-A2-after-B-snapshot.json)、[控制端最终断言](M01-M02-final-controller-check.json)。控制端负责 A2 现场前后读取，B Task 只操作自己的目录。

## 同 Task 结果

~~~text
test-5-f8f23e188c07/workdir/
├─ validation-fixture/
│  ├─ seed/.git/
│  └─ M02-local-fixture.git/
└─ winning-platform-monorepo/       ← TFS root，status 干净
   ├─ .git/                        ← root 自有元数据
   └─ winning-dps-df-common/        ← 本地测试 child
      ├─ .git/                     ← child 自有元数据
      ├─ README.txt                ← 有跟踪改动
      └─ M02-A2-f8f23e188c07-untracked.txt
~~~

| 核对项 | 结果 |
| --- | --- |
| root 与 child Git 根目录、元数据独立 | PASS |
| 二级路径来自 registry、目标边界正确 | PASS |
| 根仓既有规则忽略 child，status 与跟踪文件不受污染 | PASS |
| 同 Task 原生 checkout 保留 child 及脏修改 | PASS |
| 独立 Run 隔离与 A2 现场完整性 | PASS，B 未带入 child，A2 前后逐项一致 |
| 当前沙箱自主 clone | FAIL，已由控制端辅助准备 fixture |

保留的 child Hash：README.txt 为 fed512d7a8fa17e04594fbcc4202b698050f1d33901b3243fc9a52e9919eb915；未跟踪标记为 d60e4bb10827e3b6457f5001892139f28d9990542f306a7474ea9d04eb03ef63。

## 设计影响和未覆盖项

证据支持既定二级独立仓结构，不需要改变 Project Resource 关系。同 Task 的普通 root checkout 保留嵌套子仓；独立新 Task 只取得自己的根仓，业务子仓须再次 prepare，本机未提交/未发布修改不会自动搬迁。跨机器从已发布 Commit 恢复仍须后续验收。

当前沙箱的 clone 执行权限是部署阻碍，外部 fixture 支持不等于该阻碍已修复；需在既有 Runtime 的工具执行边界内另行解决，再验收自主准备。原始 Task 报告中“autonomous dev prepare FAIL”仅能解释为自主 Git 准备前置失败，**rondo dev prepare 命令本身未执行，命令验收为 NOT_RUN**。

跨机器恢复、同一 Issue 的默认 rerun-session 复用、真实业务仓认证/Push、未推送业务 Commit 恢复、Rondo dev prepare 和完整 V10 均未覆盖。保留 A2/B 现场，不通过 reset、clean、fresh 或删除 cache 清理；无生产交付事实变更。
