/**
 * TFS 2018 客户端封装（移植自 services/tfs-mcp/src/utils/tfs-client.ts，去掉 MCP/collection 管理层）
 *
 * 关键 TFS 2018 兼容事实（来自 tfs-mcp 实践）：
 * - 读操作可用 azure-devops-node-api SDK（queryByWiql / getWorkItems / getRepository / getBranches / getPullRequest(s) / createPullRequest）；
 * - 工作项写操作（PATCH）与 PR-工作项关联必须走 raw HTTP + api-version=4.1（SDK 内部 7.1-preview TFS 2018 不支持）。
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as azureDevOps from 'azure-devops-node-api';
import { loadConfig, TfsCliConfig } from './config.js';
import { withTransientRetry } from './retry.js';
import { UnknownError, FailError } from '../cli/errors.js';
export { UnknownError, FailError };

const REQUEST_TIMEOUT_MS = 45000;

// M3.3：agent 可变 + resetTfsAgents——keepAlive 池里可能躺着已死的半开连接，
// 瞬态重试前整池销毁重建，避免"重试仍踩同一根坏连接"。
let httpAgent = new http.Agent({ timeout: REQUEST_TIMEOUT_MS, keepAlive: true });
let httpsAgent = new https.Agent({ timeout: REQUEST_TIMEOUT_MS, keepAlive: true });

/** 销毁并重建全局 agent 池（瞬态重试的 onBeforeRetry 用）。destroy 会关闭池内连接，调用方须避免与并行写请求共享重建过程。 */
export function resetTfsAgents(): void {
  httpAgent.destroy();
  httpsAgent.destroy();
  httpAgent = new http.Agent({ timeout: REQUEST_TIMEOUT_MS, keepAlive: true });
  httpsAgent = new https.Agent({ timeout: REQUEST_TIMEOUT_MS, keepAlive: true });
}


export class TfsClient {
  readonly config: TfsCliConfig;
  private connection: azureDevOps.WebApi;
  private witApi: any = null;
  private gitApi: any = null;
  private coreApi: any = null;

  constructor() {
    this.config = loadConfig();
    this.connection = this.buildConnection();
  }

  private buildConnection(): azureDevOps.WebApi {
    const authHandler = azureDevOps.getPersonalAccessTokenHandler(this.config.pat);
    const agent = this.config.serverUrl.startsWith('https') ? httpsAgent : httpAgent;
    return new azureDevOps.WebApi(this.config.serverUrl, authHandler, { agent } as any);
  }

  /** 瞬态重试前重建传输层：agent 池 + WebApi + 已缓存的子 API（SDK 内部持有旧连接）。 */
  rebuildTransport(): void {
    resetTfsAgents();
    this.connection = this.buildConnection();
    this.witApi = null;
    this.gitApi = null;
    this.coreApi = null;
  }

  async getWitApi(): Promise<any> {
    if (!this.witApi) this.witApi = await this.connection.getWorkItemTrackingApi();
    return this.witApi;
  }

  async getGitApi(): Promise<any> {
    if (!this.gitApi) this.gitApi = await this.connection.getGitApi();
    return this.gitApi;
  }

  async getCoreApi(): Promise<any> {
    if (!this.coreApi) this.coreApi = await this.connection.getCoreApi();
    return this.coreApi;
  }

  /**
   * raw HTTP 请求（自动带 PAT Basic Auth；body 自动算 Content-Length）。
   * M3.3：显式传入当前 agent（不再依赖 http.globalAgent 隐式池）；
   * 仅 GET 内部做瞬态重试（重试前重建 agent 池）——PATCH/POST 绝不自动重试
   * （写路径的恢复由调用方按回读确认处理）。
   */
  rawRequest(
    url: string,
    method: string,
    body: string | null = null,
    headers: Record<string, string> = {}
  ): Promise<{ statusCode: number; body: string }> {
    const once = () => this.rawRequestOnce(url, method, body, headers);
    if (method.toUpperCase() !== 'GET') return once();
    return withTransientRetry(once, { onBeforeRetry: () => resetTfsAgents(), what: `GET ${new URL(url).pathname}` });
  }

  private rawRequestOnce(
    url: string,
    method: string,
    body: string | null,
    headers: Record<string, string>
  ): Promise<{ statusCode: number; body: string }> {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const bodyBuffer = body ? Buffer.from(body, 'utf-8') : null;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      agent: isHttps ? httpsAgent : httpAgent,
      headers: {
        ...headers,
        Authorization: `Basic ${Buffer.from(':' + this.config.pat).toString('base64')}`,
        Accept: 'application/json',
        ...(bodyBuffer ? { 'Content-Length': bodyBuffer.length } : {}),
      },
    };

    return new Promise((resolve, reject) => {
      const mod = isHttps ? https : http;
      const req = mod.request(options, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: data }));
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new UnknownError(`TFS 请求超时（${REQUEST_TIMEOUT_MS / 1000}s）：${urlObj.hostname}`));
      });
      req.on('error', (e) => reject(new UnknownError(`TFS 连接失败：${e.message}`)));
      if (bodyBuffer) req.write(bodyBuffer);
      req.end();
    });
  }

  /** 二进制变体（附件下载用）：响应按 Buffer 拼接，不做字符串解码；GET，同享瞬态重试 */
  rawRequestBuffer(url: string): Promise<{ statusCode: number; body: Buffer }> {
    return withTransientRetry(() => this.rawRequestBufferOnce(url), {
      onBeforeRetry: () => resetTfsAgents(),
      what: `GET ${new URL(url).pathname}（附件）`,
    });
  }

  private rawRequestBufferOnce(url: string): Promise<{ statusCode: number; body: Buffer }> {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      agent: isHttps ? httpsAgent : httpAgent,
      headers: {
        Authorization: `Basic ${Buffer.from(':' + this.config.pat).toString('base64')}`,
      },
    };
    return new Promise((resolve, reject) => {
      const mod = isHttps ? https : http;
      const req = mod.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ statusCode: res.statusCode || 0, body: Buffer.concat(chunks) }));
      });
      req.setTimeout(REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new UnknownError(`TFS 请求超时（${REQUEST_TIMEOUT_MS / 1000}s）：${urlObj.hostname}`));
      });
      req.on('error', (e) => reject(new UnknownError(`TFS 连接失败：${e.message}`)));
      req.end();
    });
  }

  /** 工作项页面 URL（TFS 2018 WIQL 不返回 web URL，自行构造） */
  workItemWebUrl(id: number, project?: string): string {
    const proj = project || this.config.project;
    return proj
      ? `${this.config.serverUrl}/${encodeURIComponent(proj)}/_workitems/edit/${id}`
      : `${this.config.serverUrl}/_workitems/edit/${id}`;
  }
}
