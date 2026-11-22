# Frontend Review Standards（工程标准轴 · 前端细化）

> **本文件为前端工程标准轴细化的唯一权威**（通用维度源自 04 §8.3，已照录为正文）。规格/修复一致性轴见 `development-execution/methods/code-review.md`，不在此重复。语义背景：04（根级现行版 `projects/multica/04-engineer-development-design.md`）。

## 通用维度（04 §8.3，照录）

Repository Conventions、Complexity、Duplication、Contract Risk、Error Handling、Test Quality、Regression Risk、Maintainability、Safety / Security。只为当前 Diff 适用的维度检查，不为无关文件扩大 Review Scope。

## 前端领域细化

| 维度 | 前端检查点 |
|---|---|
| 组件设计 | 单一职责，不堆砌无关功能；props 定义清晰（类型/默认值/必填）；emit 事件语义明确；不跨层直接改父组件状态 |
| 状态管理 | store（Vuex）改动遵循既有模块划分；不在组件内维护应共享的状态；异步 action 有 loading / 错误态 |
| 交互完整性 | 表单有必填/格式校验与错误提示；操作有反馈（loading / 成功 / 失败提示）；权限控制下的元素可见性正确 |
| 类型与空值 | 接口返回字段做空值/缺省防护（无 TS，靠纪律）；列表渲染 key 稳定 |
| 兼容性 | API 调用与后端契约一致（字段名/类型/错误码）；路由变化不破坏既有入口/分享链接 |
| 构建质量 | `npm run build` 无新增 warning；`npm run lint` 无新增 error；不引入未声明依赖 |
| Test Quality | 仓内无测试框架时，浏览器行为证据覆盖改动的主路径与错误路径（见 feedback-signals）；不虚构测试 |

## 使用纪律

- Finding 必须落到五要素（ID / Severity / Area / Evidence / Suggestion），引用上表条目作为判定依据之一；
- 上表未覆盖的前端问题照常可提 Finding（04 §8.3 通用维度兜底），本表是细化不是白名单；
- Blocking 判定与解决要求见 methods/code-review.md（唯一权威），本文件不重复定义。
