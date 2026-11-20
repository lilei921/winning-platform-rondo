/**
 * doctor/checks/network-probe.ts — 网络基线探针（rll5-replay-remediation-plan M3.0，opt-in）。
 *
 * 目的：先量化再动刀——对 Multica/TFS 端点做直连 vs 代理对照采样，输出失败率基线，
 * 确认掐断点在本机/代理/服务端哪一段；不预设结论（GODEBUG=tlsmlkem=0 已证明不能根治）。
 *
 * 设计约束：
 * - opt-in 检查（registry optIn）：默认 doctor 输出字节级不变，仅 --require network_baseline 选中；
 * - 采样参数经 doctor --network-sample/--network-interval 注入（默认单次）；
 * - 本检查自身绝不抛异常（doctor 不得成为故障源）——任何内部错误收敛为 WARN detail；
 * - 直连腿用全局 fetch（Node 不走 HTTP(S)_PROXY env，天然即直连）；
 *   代理腿用 Win10+ 自带 curl.exe -x（无新增依赖；curl 缺失 → skipped_no_curl）；
 * - 红线沿用 connectivity.ts：PAT 只进请求头，永不进 detail/remediation 输出。
 */

import { ConfigError, loadConfig } from "../../../tfs/config.js";
import { INTERNAL_NPM_REGISTRY, PROBE_TIMEOUT_MS } from "../expectations.js";
import { fetchProbe, runProbe } from "../probe.js";
import type { CheckContext, CheckOutcome } from "./registry.js";

export interface LegResult {
  attempts: number;
  ok: number;
  fail: number;
  rtt_ms: { min: number; avg: number; max: number };
  last_error?: string;
}

export type ProxyLeg = LegResult | "skipped_no_proxy_env" | "skipped_no_curl";

export interface NetworkTargetResult {
  target: string;
  direct: LegResult;
  proxy: ProxyLeg;
  proxy_env: Record<string, "set" | "unset">;
  note?: string;
}

interface ProbeTarget {
  label: string;
  url: string;
  headers?: Record<string, string>;
}

/** 聚合单次成败与 RTT 为 LegResult（纯函数，供单测）。 */
export function aggregateLeg(attempts: Array<{ ok: boolean; rttMs: number; error?: string }>): LegResult {
  const okList = attempts.filter((a) => a.ok);
  const rtts = okList.map((a) => a.rttMs);
  const leg: LegResult = {
    attempts: attempts.length,
    ok: okList.length,
    fail: attempts.length - okList.length,
    rtt_ms: rtts.length > 0
      ? { min: Math.min(...rtts), avg: Math.round(rtts.reduce((s, v) => s + v, 0) / rtts.length), max: Math.max(...rtts) }
      : { min: 0, avg: 0, max: 0 },
  };
  const lastErr = [...attempts].reverse().find((a) => a.error)?.error;
  if (lastErr) leg.last_error = lastErr;
  return leg;
}

/** 解析 curl -w "%{http_code} %{time_total}" 输出（纯函数，供单测）。 */
export function parseCurlWriteOut(stdout: string): { httpCode: string; totalMs: number } | null {
  const m = stdout.trim().match(/^(\d{3})\s+([0-9.]+)\s*$/);
  if (!m) return null;
  return { httpCode: m[1], totalMs: Math.round(parseFloat(m[2]) * 1000) };
}

/** 代理 env 检出（HTTPS_PROXY 优先，回退 HTTP_PROXY；含小写变体）。 */
export function detectProxyEnv(): { proxyUrl: string | null; env: Record<string, "set" | "unset"> } {
  const env: Record<string, "set" | "unset"> = {};
  for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"]) {
    env[k] = process.env[k] || process.env[k.toLowerCase()] ? "set" : "unset";
  }
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || null;
  return { proxyUrl, env };
}

function buildTargets(): { targets: ProbeTarget[]; notes: string[] } {
  const targets: ProbeTarget[] = [];
  const notes: string[] = [];
  try {
    const cfg = loadConfig();
    const auth = Buffer.from(`:${cfg.pat}`).toString("base64");
    targets.push({
      label: "tfs",
      url: `${cfg.serverUrl}/_apis/projects?$top=1&api-version=2.2`,
      headers: { Authorization: `Basic ${auth}` },
    });
  } catch (exc) {
    if (exc instanceof ConfigError) notes.push(`TFS 配置缺失（${exc.message}），跳过 tfs 目标`);
    else throw exc;
  }
  targets.push({ label: "internal_npm", url: INTERNAL_NPM_REGISTRY });
  const multicaApi = (process.env.MULTICA_API_URL ?? "").trim();
  if (multicaApi) {
    targets.push({ label: "multica_api", url: multicaApi.replace(/\/$/, "") });
  } else {
    notes.push("未设置 MULTICA_API_URL，跳过 multica_api 目标（不虚构发现路径）");
  }
  return { targets, notes };
}

async function sampleDirect(t: ProbeTarget, count: number, intervalMs: number): Promise<LegResult> {
  const attempts: Array<{ ok: boolean; rttMs: number; error?: string }> = [];
  for (let i = 0; i < count; i++) {
    const t0 = performance.now();
    const r = await fetchProbe(t.url, PROBE_TIMEOUT_MS, t.headers);
    const rttMs = Math.round(performance.now() - t0);
    const ok = r.ok && r.status !== undefined && r.status < 400;
    attempts.push({ ok, rttMs, error: ok ? undefined : r.ok ? `HTTP ${r.status}` : r.error });
    if (i + 1 < count && intervalMs > 0) await new Promise((r2) => setTimeout(r2, intervalMs));
  }
  return aggregateLeg(attempts);
}

async function sampleProxy(t: ProbeTarget, proxyUrl: string, count: number, intervalMs: number): Promise<LegResult | "skipped_no_curl"> {
  const attempts: Array<{ ok: boolean; rttMs: number; error?: string }> = [];
  for (let i = 0; i < count; i++) {
    const args = ["-sS", "-o", process.platform === "win32" ? "NUL" : "/dev/null",
      "-w", "%{http_code} %{time_total}", "-x", proxyUrl,
      "--max-time", String(Math.ceil(PROBE_TIMEOUT_MS / 1000))];
    for (const [k, v] of Object.entries(t.headers ?? {})) args.push("-H", `${k}: ${v}`);
    args.push(t.url);
    const r = await runProbe("curl", args, { timeoutMs: PROBE_TIMEOUT_MS + 3000 });
    if (r.spawnError && /ENOENT|not found|spawn/i.test(r.spawnError)) return "skipped_no_curl";
    const parsed = r.ok ? parseCurlWriteOut(r.stdout) : null;
    const ok = parsed !== null && parsed.httpCode !== "000" && parseInt(parsed.httpCode, 10) < 400;
    attempts.push({
      ok,
      rttMs: parsed?.totalMs ?? 0,
      error: ok ? undefined : r.timedOut ? "超时" : r.spawnError ?? (parsed ? `HTTP ${parsed.httpCode}` : (r.stderr.trim().split(/\r?\n/)[0] || `rc=${r.status}`)),
    });
    if (i + 1 < count && intervalMs > 0) await new Promise((r2) => setTimeout(r2, intervalMs));
  }
  return aggregateLeg(attempts);
}

function formatLeg(name: string, leg: ProxyLeg): string {
  if (typeof leg === "string") return `${name} ${leg}`;
  const base = `${name} ${leg.ok}/${leg.attempts} 成功`;
  const rtt = leg.ok > 0 ? ` rtt ${leg.rtt_ms.min}/${leg.rtt_ms.avg}/${leg.rtt_ms.max}ms` : "";
  const err = leg.last_error ? ` 末次错误: ${leg.last_error}` : "";
  return base + rtt + err;
}

export async function checkNetworkBaseline(ctx: CheckContext): Promise<CheckOutcome> {
  const name = "network_baseline";
  try {
    const sample = ctx.networkSample ?? { count: 1, intervalMs: 0 };
    const { targets, notes } = buildTargets();
    const { proxyUrl, env } = detectProxyEnv();

    const results: NetworkTargetResult[] = [];
    for (const t of targets) {
      const direct = await sampleDirect(t, sample.count, sample.intervalMs);
      const proxy: ProxyLeg = proxyUrl === null
        ? "skipped_no_proxy_env"
        : await sampleProxy(t, proxyUrl, sample.count, sample.intervalMs);
      results.push({ target: t.label, direct, proxy, proxy_env: env });
    }

    const directFailing = results.some((r) => r.direct.fail > 0);
    const proxyFailing = results.some((r) => typeof r.proxy !== "string" && r.proxy.fail > 0);
    const allPass = !directFailing && !proxyFailing;

    const parts = results.map((r) => `[${r.target}] ${formatLeg("direct", r.direct)}; ${formatLeg("proxy", r.proxy)}`);
    const envDesc = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ");
    const detail = `采样 ${sample.count} 次/腿（间隔 ${sample.intervalMs}ms）\n${parts.join("\n")}\n代理 env: ${envDesc}${notes.length ? `\n${notes.join("\n")}` : ""}`;

    return {
      name,
      level: "WARN",
      result: allPass ? "PASS" : "WARN",
      failure_kind: allPass ? undefined : directFailing && proxyFailing ? "both_failing" : directFailing ? "direct_failing" : "proxy_failing",
      detail,
      remediation: allPass ? undefined
        : "对照失败腿定位掐断段：direct 失败而 proxy 通→本机/直连链路；proxy 失败而 direct 通→代理策略（周期性掐长连接落在基础设施侧，rondo 只能缓解）；两者皆败→服务端或对端网络。长基线采样：rondo doctor --require network_baseline --network-sample 12 --network-interval 300000（5min×1h）",
    };
  } catch (exc) {
    // 本检查绝不抛出（双保险，registry guard 之外再兜一层）
    return { name, level: "WARN", result: "WARN", failure_kind: "probe_error", detail: `network_baseline 自身异常: ${exc instanceof Error ? exc.message : String(exc)}` };
  }
}
