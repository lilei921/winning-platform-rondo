# M11 — 权限与 HTTP 适配部署验证

- 日期：2026-11-13；总体状态：**NOT_RUN（权限/传输策略 Gate 缺条件）**；HTTP 适配器子项 **PASS**。
- [脚本](m11-adapter-validation.mjs) / [机器证据](M11-adapter-evidence.json)。仅记录凭据存在性，不输出或保存凭据。

通过已安装 Rondo 1.2.20 的真实 TfsClient.rawRequest，使用 API 4.1 对既有 T11 Commit `43cde17b8e8d8944c73ec964a2543991196b9921` 重新 GET；中文、空格、#、%、混合、字面量 %23/%25 六组路径均 HTTP 200，返回 Commit、路径与内容 Hash 精确匹配既有 fixture。没有重新创建测试文件或分支。URL 构造使用 URLSearchParams；这验证 HTTP 传输与编码组合，不宣称未来通用源码读取 CLI 已实现。

对现有 readAnalysisArtifact 的响应边界，在进程内模拟非 JSON 404/401/403/200：404→FailError，401/403→UnknownError，200 非 JSON→UnknownError；各只调用一次，不回退本地或其他版本。现有 analysis-read/source/Bug Candidate 测试在获批控制端环境 **18/18 PASS**，[日志](M03-M11-adapter-regression.log)。初次沙箱中 3 项本机 HTTP fixture timeout 已保留为环境限制，不写成真实 Runtime HTTP 测试通过。

未完成：经批准低权限身份的授权读取/拒绝读取/拒绝写入，以及组织 HTTP/HTTPS 使用策略。现有凭据可以读取不代表只读权限成立，用户提供 Work Item 也不代表批准网络策略。未用正式仓做负向写入，未降低部署 Gate。
