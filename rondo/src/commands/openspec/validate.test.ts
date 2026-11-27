/** The Analysis Gate result is returned to the caller, never persisted. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitResult } from "./validate.js";

function capture<T>(run: () => T): { code: T; output: string } {
  const original = process.stdout.write.bind(process.stdout);
  let output = "";
  (process.stdout as { write: typeof original }).write = ((chunk: unknown) => {
    output += String(chunk);
    return true;
  }) as typeof original;
  try { return { code: run(), output }; }
  finally { (process.stdout as { write: typeof original }).write = original; }
}

test("Gate PASS/FAIL/UNKNOWN only returns JSON stdout; legacy outPath is not written", () => {
  const dir = mkdtempSync(join(tmpdir(), "rondo-validate-"));
  try {
    const outPath = join(dir, "logs", "analysis-gate-result.json");
    for (const [result, code] of [["PASS", 0], ["FAIL", 2], ["UNKNOWN", 3]] as const) {
      const payload = { result, checks: [], reasons: [] };
      const output = capture(() => emitResult(payload, code, outPath));
      assert.equal(output.code, code);
      assert.equal(output.output, JSON.stringify(payload, null, 2) + "\n");
      assert.equal(existsSync(outPath), false);
      assert.equal(readdirSync(dir).length, 0);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
