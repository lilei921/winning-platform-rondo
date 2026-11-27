// 保留真实 CLI / Multica 对账；仅替换进程内 TFS 客户端的网络边界。
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TfsClient } from "../dist/clients/tfs.js";
import { UnknownError } from "../dist/cli/errors.js";
const mock = fileURLToPath(new URL("./mock-tfs.cjs", import.meta.url));
TfsClient.prototype.run = async function (args, what) {
  const r = spawnSync(process.execPath, [mock, ...args], { encoding: "utf8" });
  if (r.status !== 0 && r.status !== 2) throw new UnknownError(what + ": " + r.stderr + r.stdout);
  return JSON.parse(r.stdout);
};
await import("../dist/index.js");
