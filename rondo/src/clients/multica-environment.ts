import { UnknownError } from "../cli/errors.js";

/** 环境身份随 overlay 和生成的运行配置传递，不依赖调用者记住上次的 CLI 参数。 */
export interface MulticaEnvironment {
  multica_profile?: string;
  multica_server_url?: string;
}

function profileArgs(profile: string | undefined): string[] {
  if (profile !== undefined && (typeof profile !== "string" || !/^[\w.-]+$/.test(profile))) {
    throw new UnknownError("Multica profile 必须为非空名称（字母、数字、下划线、点或短横线）");
  }
  return profile ? ["--profile", profile] : [];
}

/** 已绑定服务且未指定 profile 表示默认环境，不能再被调用进程的偏好覆盖。 */
function effectiveProfile(env: MulticaEnvironment): string | undefined {
  return env.multica_profile ?? (env.multica_server_url ? undefined : process.env.RONDO_MULTICA_PROFILE);
}

export function multicaPrefix(runtime: MulticaEnvironment & { multica_cli: string }): string[] {
  const server = runtime.multica_server_url;
  return [runtime.multica_cli, ...profileArgs(effectiveProfile(runtime)), ...(server ? ["--server-url", server] : [])];
}

/** 禁止用另一个 profile/服务地址覆盖已有工作区 ID；旧 overlay 可首次绑定当前环境。 */
export function bindEnvironment(
  overlay: MulticaEnvironment,
  requested: unknown,
  serverOf: (prefix: string[]) => string,
): MulticaEnvironment {
  if (requested !== undefined && (typeof requested !== "string" || !requested)) {
    throw new UnknownError("--profile 缺少有效名称");
  }
  const profile = (requested as string | undefined) ?? effectiveProfile(overlay);
  if (overlay.multica_server_url && (profile ?? "") !== (overlay.multica_profile ?? "")) {
    throw new UnknownError("overlay 已绑定其他 profile；请为不同环境使用独立 workspace 名称");
  }
  // 不传固定 server-url，才能检测 CLI 配置中的服务地址是否发生漂移。
  const prefix = ["multica", ...profileArgs(profile)];
  const server = serverOf(prefix).replace(/\/+$/, "");
  try {
    const url = new URL(server);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { throw new UnknownError("无法确定 Multica server_url，禁止供给或同步"); }
  if (overlay.multica_server_url && overlay.multica_server_url.replace(/\/+$/, "") !== server) {
    throw new UnknownError("profile 当前 server_url 与 overlay 绑定不一致，禁止跨环境覆盖");
  }
  return { ...(profile ? { multica_profile: profile } : {}), multica_server_url: server };
}
