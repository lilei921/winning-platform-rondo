/**
 * materialize-tasks extractTaskText 行尾兼容回归（2026-11-03 WNDF-52 D1 同类排雷）。
 * 背景：`(.*)$` 中 `.` 不匹配 `\r`，CRLF tasks.md 行提取失败；修复为 `(.*)\r?$`。
 */
import test from "node:test";
import assert from "node:assert/strict";
const MOD = new URL("../dist/commands/tfs/materialize-tasks.js", import.meta.url);
const { extractTaskText } = await import(MOD);

test("extractTaskText：LF 行正常提取", () => {
  const text = "# Tasks\n\n- [ ] 1.1 实现功能 A [预估: 1h]\n- [x] 1.2 实现功能 B\n";
  assert.equal(extractTaskText(text, "1.1"), "实现功能 A [预估: 1h]");
  assert.equal(extractTaskText(text, "1.2"), "实现功能 B");
});

test("extractTaskText：CRLF 行正常提取（D1 同类回归）", () => {
  const text = "# Tasks\r\n\r\n- [ ] 1.1 实现功能 A [预估: 1h]\r\n- [x] 1.2 实现功能 B\r\n";
  assert.equal(extractTaskText(text, "1.1"), "实现功能 A [预估: 1h]");
  assert.equal(extractTaskText(text, "1.2"), "实现功能 B");
});

test("extractTaskText：ref 不存在返回 null", () => {
  const text = "- [ ] 1.1 实现功能 A\r\n";
  assert.equal(extractTaskText(text, "9.9"), null);
});
