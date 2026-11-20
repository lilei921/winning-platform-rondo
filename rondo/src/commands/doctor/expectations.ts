/**
 * doctor/expectations.ts — 期望版本与环境常量（rondo-doctor-env-check-plan §5.3，单一事实源）。
 *
 * openspec 契约版本升级时需同步本文件（方案 §10 开放问题 1，P2 再评估抽配置）。
 */

/** node 期望区间：>=18.19（与 package.json engines 对齐）。 */
export const EXPECTED_NODE_MIN = { major: 18, minor: 19 } as const;
export const EXPECTED_NODE_RANGE_DESC = ">=18.19";

/** openspec 契约期望版本（--expect-openspec 可覆盖）。 */
export const DEFAULT_EXPECTED_OPENSPEC_VERSION = "1.13.2";
export const OPENSPEC_PACKAGE = "@fission-ai/openspec";

/** rondo 自身最低版本下限（analyst-skill-command-contract-restoration-plan R3）：
 * 低于此版本时 workitem-analysis 依赖的 resolve-identity 首跑 NOT_FOUND 语义不成立。
 * rondo_self 检查据此 WARN；`--require rondo_self` 模式下 WARN 按 FAIL 计（供给阶段可拦截旧 CLI）。 */
export const MIN_RONDO_VERSION = "1.2.1";

/** 内部 npm 源（npm_registry_config / internal_npm_registry 共用）。 */
export const INTERNAL_NPM_REGISTRY = "http://172.16.9.57:8081/repository/npm-group/";

/** TFS 三件套：PAT/URL 必须配置在用户环境变量；COLLECTION 未配有默认值。 */
export const TFS_USER_ENV_VARS = ["TFS_PAT", "TFS_URL"] as const;
export const TFS_COLLECTION_VAR = "TFS_COLLECTION";
// 复用请求配置的默认集合，避免诊断提示与实际目标漂移。
export { DEFAULT_COLLECTION as DEFAULT_TFS_COLLECTION } from "../../tfs/config.js";

/** daemon 场景必需环境变量清单（与 tfs/config.ts、check-daemon.ts 实际消费对齐）。 */
export const DAEMON_ENV_VARS = ["TFS_PAT", "TFS_URL", "TFS_COLLECTION", "MULTICA_DAEMON_ID"] as const;

/** 单项探测超时（方案 §5.4：本地探测与连通性均 2s，并行后全程 ≤3s）。 */
export const PROBE_TIMEOUT_MS = 2000;
