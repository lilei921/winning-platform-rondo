/**
 * workspace/skill-refs.ts — 技能包 references 引用完整性校验（rll5-replay-remediation-plan M6，F6 防复发）。
 *
 * 背景：技能包按包安装，运行时没有跨包目录；跨包引用 `other-skill/references/x.md`
 * 在已安装环境里打不开（RLL-5 F6：Wayfinder 读不到 pull-request 的隔离契约）。
 * 引用纪律（本校验强制）：
 * - 包内引用 `references/<file>`：必须存在于本包（缺失 → missing_local）；
 * - 跨包引用 `<skill>/references/<file>`：必须存在于 skillsRoot（缺失 → missing_cross_skill），
 *   且仅限"单一属主、不镜像"的内容（镜像引用应写包内路径）。
 * 扫描范围：包内 SKILL.md 与全部 **\/*.md 中反引号包裹的 references 路径。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface SkillRefProblem {
  skill: string;
  /** 引用出现的包内相对路径 */
  file: string;
  /** 反引号内的引用文本 */
  ref: string;
  kind: "missing_local" | "missing_cross_skill";
}

const REF_RE = /`((?:[\w-]+\/)?references\/[^`\s]+?\.md)`/g;

export function validateSkillReferences(skillsRoot: string, skill: string): SkillRefProblem[] {
  const dir = join(skillsRoot, skill);
  const problems: SkillRefProblem[] = [];
  const mds: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) mds.push(p);
    }
  };
  walk(dir);
  for (const f of mds) {
    const relFile = relative(dir, f).split(sep).join("/");
    const text = readFileSync(f, "utf8");
    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(text))) {
      const ref = m[1];
      if (ref.startsWith("references/")) {
        if (!existsSync(join(dir, ref))) problems.push({ skill, file: relFile, ref, kind: "missing_local" });
      } else if (!existsSync(join(skillsRoot, ref))) {
        problems.push({ skill, file: relFile, ref, kind: "missing_cross_skill" });
      }
    }
  }
  return problems;
}
