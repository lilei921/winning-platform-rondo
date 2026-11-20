/**
 * clients/config.ts — repo-registry.json 配置读取。
 *
 * 各命令的 RegistryConfig 形状不同（registry 字段按需），
 * 本层只做读取、JSON 解析与 runtime 段的公共校验；命令级字段校验留在命令模块。
 */

import { readFileSync } from "node:fs";
import { UnknownError } from "../cli/errors.js";

import type { MulticaEnvironment } from "./multica-environment.js";

export interface RuntimeConfig extends MulticaEnvironment {
  multica_cli: string;
  workspace_id?: string;
  /** 显式启用 Requirement 远端收口的固定权威分支；仓库 URL 复用已批准 analysis.source。 */
  root_branch?: string;
  /** @deprecated rondo 合并后 TFS 调用进程内化,该键不再消费(方案 §5);保留仅为兼容旧 registry 文件。 */
  tfs_cli?: string[];
  delivery_squad_id?: string;
}

export interface BaseRegistryConfig {
  runtime: RuntimeConfig;
  registry?: Record<string, unknown>;
}

/**
 * 读取并校验配置。requireRegistry 控制公共校验面;
 * requireTfs 形参保留兼容旧调用点,但 rondo 进程内化后不再校验 runtime.tfs_cli(方案 §4.2)。
 */
export function loadConfig<T extends BaseRegistryConfig>(
  path: string,
  opts: { requireRegistry?: boolean; requireTfs?: boolean } = {},
): T {
  const { requireRegistry = true } = opts;
  let cfg: T;
  try {
    cfg = JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (exc) {
    throw new UnknownError(`无法读取配置 ${path}: ${exc}`);
  }
  const missing: string[] = [];
  if (!cfg.runtime?.multica_cli) missing.push("runtime.multica_cli");
  if (requireRegistry && !cfg.registry) missing.push("registry");
  if (missing.length > 0) {
    throw new UnknownError(`配置缺少 ${missing.join(" / ")}`);
  }
  return cfg;
}
