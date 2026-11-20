# Backend Review Standards（工程标准轴 · 后端细化）

> **本文件为后端工程标准轴细化的唯一权威**（通用维度源自 04 §8.3，已照录为正文）。规格/修复一致性轴见 `development-execution/methods/code-review.md`，不在此重复。语义背景：04（根级现行版 `projects/multica/04-engineer-development-design.md`）。

## 通用维度（04 §8.3，照录）

Repository Conventions、Complexity、Duplication、Contract Risk、Error Handling、Test Quality、Regression Risk、Maintainability、Safety / Security。只为当前 Diff 适用的维度检查，不为无关文件扩大 Review Scope。

## 后端领域细化

| 维度 | 后端检查点 |
|---|---|
| 迁移安全 | DDL/DML 迁移脚本可重复执行或有明确一次性语义；有回滚路径或说明；不破坏存量数据（默认值、NOT NULL 新增列的存量处理）；大表操作评估锁/耗时 |
| 事务 | 事务边界覆盖完整业务操作（不少不多）；只读查询不裹进写事务；跨数据源操作不以单事务假装修饰；异常路径触发回滚而非部分提交 |
| 兼容性 | API 变更向后兼容（字段只增不删改，或明确版本策略）；序列化格式变化不影响存量消息/缓存；DB Schema 变化与旧代码共存期兼容（先加后删） |
| 错误处理 | 异常不被吞（空 catch / 只 log 不处理）；错误信息不含敏感数据；外部调用失败有明确语义（重试/降级/上抛） |
| 并发与资源 | 共享状态有同步语义；连接/流/文件句柄有释放路径；批处理有分页/限量，不全量载入内存 |
| Contract Risk | 改动是否影响上游调用方（SPI / API 模块的公开签名）；跨仓接口变更是否已有对应约束引用（见 feedback-signals §3） |
| Test Quality | 测试断言针对行为而非实现细节；负向/边界路径有覆盖；不注释掉失败测试来"通过" |

## 使用纪律

- Finding 必须落到五要素（ID / Severity / Area / Evidence / Suggestion），引用上表条目作为判定依据之一；
- 上表未覆盖的后端问题照常可提 Finding（04 §8.3 通用维度兜底），本表是细化不是白名单；
- Blocking 判定与解决要求见 methods/code-review.md（唯一权威），本文件不重复定义。
