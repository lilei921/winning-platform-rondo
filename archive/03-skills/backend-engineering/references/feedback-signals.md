# Backend Feedback Signals（后端反馈信号清单）

> **本文件为后端反馈信号细则的唯一权威**（04 §5.3 的操作化；总原则引自 04 §5.2）。语义背景：04（根级现行版 `projects/multica/04-engineer-development-design.md`）。

## 总原则（04 §5.2 引述）

> 主要代码修改之前必须识别能证明本次行为或修复正在收敛的可靠、可观察 Signal，并在修改过程中持续使用。

Signal 不必是同一个测试框架；编译成功不能替代用户可见行为或 Task Verification；无法自动测试时不得伪造 RED / GREEN。

## 可用 Signal（按改动类型选最小可靠集）

| 改动类型 | 首选 Signal | 备选 / 补充 |
|---|---|---|
| 业务规则 / 计算 / 状态转换 | Unit / Domain Test（JUnit） | — |
| 异常路径 / 边界输入 | Unit Test（负向用例） | — |
| 接口行为 / 权限 / 序列化 | Integration / Contract Test | API Reproduction（实际调用记录） |
| 跨模块协作 | Integration Test | 定向回归 |
| DB Schema / 迁移 | Migration Validation（脚本可执行 + 回滚路径核对） | 事务边界检查 |
| 纯重构（无行为变化） | 既有测试全集 PASS + Build | 静态分析 |
| SQL / Mapper | 定向测试或实际执行记录 | 执行计划 / 结果集核对 |
| 构建 / 依赖 / 配置 | Build（`mvnw` 全量或 `-pl` 定向） | Lint / 静态检查 |

## 选择纪律

1. **最小可靠**：覆盖当前 `task_refs` 的改动面即可，不为形式跑全仓库测试；
2. **行为优先于构建**：只有 Build PASS 不构成 Behavior Evidence（04 §7.2）；
3. **跨仓 Contract**：改动涉及跨仓接口时，保留约束引用，必要时报 Delivery Lead 追加组合 Verification Task，不在本 Skill 内擅自扩范围；
4. **Corrective 回归**：可稳定复现的缺陷须留修复前 FAIL / 修复后 PASS 的对应证据；不可复现时用可靠替代证据并写明局限（04 §5.6）。
