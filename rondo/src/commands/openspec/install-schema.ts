/**
 * openspec install-schema —— 把随 rondo 分发的 OpenSpec Schema 安装到用户全局目录。
 * 对应 .cache/install_openspec_schemas.py 的本地安装路径：不访问网络、不做 CLI 校验，
 * 同名 Schema 直接覆盖（不保留旧版备份），其他 Schema 不受影响。
 * 退出码：0 成功 / 2 安装失败 / 64 用法错误。
 */
import { Command } from "commander";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { emitJson, markLeafExecuted } from "../../cli/output.js";

/** 与 OpenSpec 1.13.2 getGlobalDataDir 对齐：XDG_DATA_HOME / LOCALAPPDATA / ~/.local/share。 */
export function globalSchemasDir(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform): string {
  const xdg = env.XDG_DATA_HOME?.trim();
  const base = xdg || (platform === "win32"
    ? env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    : path.join(os.homedir(), ".local", "share"));
  return path.join(base, "openspec", "schemas");
}

/** 直接覆盖同名 Schema 目录；只有带 schema.yaml 的子目录才视为 Schema。 */
export function installSchemas(source: string, target: string): string[] {
  const names = readdirSync(source, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(source, entry.name, "schema.yaml")))
    .map(entry => entry.name)
    .sort();
  if (!names.length) throw new Error(`源目录没有可用的 Schema：${source}`);
  mkdirSync(target, { recursive: true });
  for (const name of names) {
    const destination = path.join(target, name);
    rmSync(destination, { recursive: true, force: true });
    cpSync(path.join(source, name), destination, { recursive: true });
  }
  return names;
}

export function registerOpenspecInstallSchema(group: Command): void {
  group.command("install-schema").description("安装随包分发的 OpenSpec Schema 到用户全局目录")
    .addHelpText("after", "\n同名 Schema 将被覆盖；不访问网络；SEA 单文件运行不支持。")
    .action((...cbArgs: unknown[]) => {
      markLeafExecuted();
      void cbArgs;
      let answer: Record<string, unknown>;
      let exitCode = 0;
      try {
        // 命令文件位于 dist/commands/openspec/install-schema.js，包根在三级上级。
        const source = fileURLToPath(new URL("../../../openspec/schemas", import.meta.url));
        if (!existsSync(source)) throw new Error(`未找到随包分发的 Schema：${source}（SEA 单文件运行不支持）`);
        const target = globalSchemasDir();
        answer = { result: "PASS", target, installed: installSchemas(source, target) };
      } catch (exc) {
        exitCode = 2;
        answer = { result: "FAIL", reason: exc instanceof Error ? exc.message : String(exc) };
      }
      emitJson(answer, exitCode);
    });
}
