/**
 * cli/version.ts — rondo 版本单一事实源。
 * SEA 形态:构建期 esbuild define 注入 __RONDO_VERSION__;
 * npm 形态:回退读包根 package.json(承自 rondo,版本漂移治理)。
 */

import { readFileSync } from "node:fs";

declare const __RONDO_VERSION__: string | undefined;

export const TOOL_VERSION: string = (() => {
  try {
    if (typeof __RONDO_VERSION__ !== "undefined") return __RONDO_VERSION__;
  } catch {
    /* 未注入(npm 形态) */
  }
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
})();
