/**
 * workspace/skill-refs.ts 单测（rll5-replay-remediation-plan M6）。
 * 四态合成树（local 存在/缺失 × cross 存在/缺失）+ 真实仓库清扫（零问题回归闸）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkillReferences } from "./skill-refs.js";

function tree(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "skill-refs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const mk = (rel: string, content: string) => {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  };
  // alpha：四种引用形态
  mk("alpha/SKILL.md", [
    "见 `references/local-ok.md`",                 // local 存在
    "见 `references/local-missing.md`",            // local 缺失
    "见 `beta/references/cross-ok.md`",            // cross 存在
    "见 `gamma/references/cross-missing.md`",      // cross 缺失（包也不存在）
    "见 `beta/references/cross-absent.md`",        // cross 缺失（包存在文件无）
  ].join("\n"));
  mkdirSync(join(root, "alpha", "references"), { recursive: true });
  writeFileSync(join(root, "alpha", "references", "local-ok.md"), "x");
  mk("beta/SKILL.md", "ok");
  mkdirSync(join(root, "beta", "references"), { recursive: true });
  writeFileSync(join(root, "beta", "references", "cross-ok.md"), "x");
  return root;
}

test("四态分类：local/cross × 存在/缺失", (t) => {
  const root = tree(t);
  const problems = validateSkillReferences(root, "alpha");
  assert.deepEqual(
    problems.map((p) => `${p.kind}:${p.file}->${p.ref}`).sort(),
    [
      "missing_cross_skill:SKILL.md->beta/references/cross-absent.md",
      "missing_cross_skill:SKILL.md->gamma/references/cross-missing.md",
      "missing_local:SKILL.md->references/local-missing.md",
    ],
  );
});

test("嵌套 md 文件也被扫描；非反引号路径不报", (t) => {
  const root = tree(t);
  mkdirSync(join(root, "alpha", "references", "sub"), { recursive: true });
  writeFileSync(join(root, "alpha", "references", "sub", "note.md"), "引用 `references/nope.md`；裸文本 references/nope2.md 不算");
  const problems = validateSkillReferences(root, "alpha");
  assert.ok(problems.some((p) => p.file === "references/sub/note.md" && p.ref === "references/nope.md"));
  assert.ok(!problems.some((p) => p.ref.includes("nope2")));
});

test("引用全部合法 → 零问题", (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-refs-clean-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "solo", "references"), { recursive: true });
  writeFileSync(join(root, "solo", "SKILL.md"), "见 `references/a.md`");
  writeFileSync(join(root, "solo", "references", "a.md"), "x");
  assert.deepEqual(validateSkillReferences(root, "solo"), []);
});

test("真实仓库清扫：全部技能包零缺页（F6 回归闸）", () => {
  // 本文件编译后位于 rondo/dist/commands/workspace/ → 上 4 级 = 仓根
  const skillsRoot = fileURLToPath(new URL("../../../../skills/", import.meta.url));
  const skills = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const all = skills.flatMap((s) => validateSkillReferences(skillsRoot, s));
  assert.deepEqual(all, [], `真实技能包存在缺页引用: ${JSON.stringify(all, null, 2)}`);
});
