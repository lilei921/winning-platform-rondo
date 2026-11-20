/** 受控 TFS Git 认证；准备业务仓与旧 Requirement Archive 共用，不持久化凭据。 */
import { UnknownError } from "../cli/errors.js";
import { TfsClient } from "../tfs/client.js";
import { repositoryUrl } from "../commands/analysis/source.js";
import { runCommand } from "./spawn.js";
import { gitRuntime, git } from "./git.js";

type ConfigClient = Pick<TfsClient, "config">;

export function assertTfsRepository(raw: string, serverUrl: string): URL {
  const repo = repositoryUrl(raw), server = new URL(serverUrl);
  const parts = repo.pathname.split("/").map(decodeURIComponent);
  const collection = server.pathname.replace(/\/+$/, "").split("/").map(decodeURIComponent).join("/");
  if (repo.origin !== server.origin || parts.slice(0, -3).join("/").toLowerCase() !== collection.toLowerCase()) {
    throw new UnknownError("仓库不属于配置的 TFS 服务 / Collection，拒绝发送凭据");
  }
  return repo;
}

export function authenticatedGitEnvironment(repoUrl: string, client: ConfigClient): NodeJS.ProcessEnv {
  const repo = assertTfsRepository(repoUrl, client.config.serverUrl);
  if (!client.config.pat) throw new UnknownError("缺少受控 TFS 认证");
  const env = { ...process.env };
  // 不继承可能重定向仓库或覆盖精确认证的命令级 Git 配置。
  for (const key of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/.test(key)) delete env[key];
    if (key.startsWith("GIT_TRACE") || key === "GIT_CURL_VERBOSE") env[key] = "0";
  }
  const config = [["credential.helper", ""], ["http.extraHeader", ""], [`http.${repo.href}.extraHeader`, ""],
    [`http.${repo.href}.extraHeader`, `Authorization: Basic ${Buffer.from(`:${client.config.pat}`).toString("base64")}`],
    ["http.followRedirects", "false"]];
  config.forEach(([key, value], i) => { env[`GIT_CONFIG_KEY_${i}`] = key; env[`GIT_CONFIG_VALUE_${i}`] = value; });
  env.GIT_CONFIG_COUNT = String(config.length);
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_ASKPASS = "";
  return env;
}

export function runAuthenticatedGit(repoUrl: string, args: string[], cwd: string, timeoutMs?: number): ReturnType<typeof runCommand> {
  // URL 重写可能把精确 URL 的凭据送往另一主机，认证前必须拒绝。
  const rewrites = git(cwd, ["config", "--get-regexp", "^url\\..*\\.(insteadof|pushinsteadof)$"]);
  if (rewrites.status === 0) throw new UnknownError("Git URL rewrite 存在，无法确认认证目标");
  if (rewrites.status !== 1) throw new UnknownError("无法核验 Git URL rewrite");
  const client = new TfsClient();
  const runtime = gitRuntime(authenticatedGitEnvironment(repoUrl, client));
  const encoded = Buffer.from(`:${client.config.pat}`).toString("base64");
  const redact = (s: string) => s.split(client.config.pat).join("[REDACTED]").split(encoded).join("[REDACTED]");
  try {
    const r = runCommand([runtime.executable, ...args], cwd, runtime.env, timeoutMs);
    return { ...r, stdout: redact(r.stdout), stderr: redact(r.stderr) };
  } catch (e) { throw new UnknownError(redact(e instanceof Error ? e.message : String(e))); }
}
