/**
 * tfs-cli 配置注入（红线：PAT 只走环境变量 / config 文件，永不进命令行参数与输出）
 *
 * 优先级：环境变量 > config/tfs.config.json > 内置默认 URL。
 * 环境变量：TFS_PAT（必需）、TFS_COLLECTION、TFS_URL（base，不含 collection）、
 *           TFS_SERVER_URL（完整 collection URL，优先于 TFS_URL）、TFS_PROJECT。
 *
 * 配置文件查找（首个存在者生效，SEA 适配 —— projects/multica/tfs-cli-native-exe-plan.md §5.3）：
 *   1. $TFS_CLI_CONFIG 显式指定的文件路径
 *   2. process.execPath 上两级 config/tfs.config.json（exe 形态：<root>/bin/tfs-cli.exe → <root>/config/）
 *   3. import.meta.url 相对位置（npm 形态：dist/../config/）
 *   4. cwd 下 config/tfs.config.json
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TfsCliConfig {
  /** 完整 collection URL，如 http://host:8080/tfs/WN_Data_Platform */
  serverUrl: string;
  collection: string;
  project?: string;
  pat: string;
}

const DEFAULT_BASE_URL = 'http://tfs2018-web.winning.com.cn:8080/tfs';
/** TFS 默认集合，供配置解析、doctor 和帮助文本共同使用。 */
export const DEFAULT_COLLECTION = 'WN_Data_Platform';

function configFileCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.TFS_CLI_CONFIG) candidates.push(process.env.TFS_CLI_CONFIG);
  candidates.push(path.resolve(path.dirname(process.execPath), '..', 'config', 'tfs.config.json'));
  try {
    // npm/tsc 形态：dist/../config；esbuild CJS bundle 下 import.meta 为空，跳过
    const here = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(here, '..', 'config', 'tfs.config.json'));
  } catch { /* SEA/CJS bundle：import.meta.url 不可用 */ }
  candidates.push(path.resolve(process.cwd(), 'config', 'tfs.config.json'));
  return candidates;
}

function configFilePath(): string | undefined {
  return configFileCandidates().find((p) => fs.existsSync(p));
}

interface FileConfig {
  url?: string;
  collection?: string;
  project?: string;
  token?: string;
}

function readConfigFile(): FileConfig {
  const filePath = configFilePath();
  if (!filePath) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as FileConfig;
  } catch {
    return {};
  }
}

export class ConfigError extends Error {}

export function loadConfig(): TfsCliConfig {
  const file = readConfigFile();

  const collection = process.env.TFS_COLLECTION || file.collection || DEFAULT_COLLECTION;

  let serverUrl: string;
  if (process.env.TFS_SERVER_URL) {
    serverUrl = process.env.TFS_SERVER_URL.replace(/\/$/, '');
  } else if (process.env.TFS_URL || file.url) {
    serverUrl = `${(process.env.TFS_URL || file.url)!.replace(/\/$/, '')}/${collection}`;
  } else {
    serverUrl = `${DEFAULT_BASE_URL}/${collection}`;
  }

  const pat = process.env.TFS_PAT || file.token;
  if (!pat) {
    throw new ConfigError('TFS PAT 未配置：请设置环境变量 TFS_PAT，或在 config/tfs.config.json 提供 token 字段');
  }

  return {
    serverUrl,
    collection,
    project: process.env.TFS_PROJECT || file.project,
    pat,
  };
}
