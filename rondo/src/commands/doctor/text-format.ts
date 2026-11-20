/**
 * doctor/text-format.ts — text 报告渲染（默认格式，人读；方案 §3 与附录 A）。
 *
 * doctor 的第一调用方是运维/交付人员手工执行，stdout 出人读报告是
 * rondo "stdout-JSON 优先"契约的有意例外；程序化消费显式 --format json。
 */

import type { CheckOutcome } from "./checks/registry.js";

const ICON: Record<CheckOutcome["result"], string> = {
  PASS: "✓",
  FAIL: "✗",
  WARN: "!",
  INFO: "·",
  SKIP: "·",
};

const NAME_WIDTH = 22;

/** 修复处方的依赖拓扑序（方案 §5.5）：registry 类先于一切 npm i -g 类处方。 */
const REMEDIATION_ORDER = ["npm_registry_config", "internal_npm_registry"];

export interface TextReportInput {
  overall: "PASS" | "WARN" | "FAIL";
  exitCode: number;
  checks: CheckOutcome[];
  nodeVersion: string;
  nodePath: string;
  elapsedMs: number;
}

export function renderTextReport(input: TextReportInput): string {
  const lines: string[] = [];
  lines.push(`rondo doctor — ${input.overall} (exit ${input.exitCode})`);
  lines.push(`node ${input.nodeVersion} @ ${input.nodePath} · platform ${process.platform} · ${(input.elapsedMs / 1000).toFixed(1)}s`);
  lines.push("");
  for (const c of input.checks) {
    const head = `${ICON[c.result]} ${c.name.padEnd(NAME_WIDTH)}`;
    const kind = c.failure_kind && c.result !== "PASS" ? `[${c.failure_kind}] ` : "";
    lines.push(`${head}${kind}${c.detail}`);
    if (c.remediation && c.result !== "PASS") {
      lines.push(`${"".padEnd(NAME_WIDTH + 2)}修复: ${c.remediation}`);
    }
  }
  const failed = input.checks.filter((c) => c.remediation && (c.result === "FAIL" || c.result === "WARN"));
  if (failed.length > 1) {
    const ordered = [...failed].sort((a, b) => {
      const ia = REMEDIATION_ORDER.indexOf(a.name);
      const ib = REMEDIATION_ORDER.indexOf(b.name);
      return (ia === -1 ? REMEDIATION_ORDER.length : ia) - (ib === -1 ? REMEDIATION_ORDER.length : ib);
    });
    lines.push("");
    lines.push("修复顺序（先修 registry/连通性，再执行安装类处方）:");
    ordered.forEach((c, i) => lines.push(`  ${i + 1}. [${c.name}] ${c.remediation}`));
  }
  return lines.join("\n");
}
