import { execaSync } from "execa";

/** 在 Windows 上解析 npm .cmd shim；保持测试使用的 spawnSync 返回契约。 */
export function spawnOpenspec(args, options = {}) {
  try {
    const r = execaSync("openspec", args, { cwd: options.cwd, timeout: options.timeout ?? 30000, reject: false });
    return { status: r.exitCode ?? null, stdout: r.stdout, stderr: r.stderr,
      error: r.exitCode === undefined ? new Error(r.shortMessage) : undefined };
  } catch (error) {
    return { status: null, stdout: "", stderr: "", error };
  }
}
