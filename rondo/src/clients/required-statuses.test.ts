/**
 * required-statuses 防漂移测试（workspace-workflow-status-provisioning-plan M3）。
 *
 * 断言 _shared/provisioning.json 的 workflow.statuses 覆盖流水线消费的自定义状态键，
 * 且不重复声明 multica 内建键——manifest 与 rondo 硬编码消费点的漂移在此拦截。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveMulticaRoot } from "./repo-root.js";
import { BUILTIN_STATUS_KEYS, CUSTOM_PIPELINE_STATUSES } from "./required-statuses.js";

interface ManifestStatus { key: string; name?: string; category?: string; after?: string }

function loadManifestStatuses(): ManifestStatus[] {
  const { multicaRoot } = resolveMulticaRoot();
  const manifest = JSON.parse(
    readFileSync(join(multicaRoot, "workspace-skills", "_shared", "provisioning.json"), "utf8"),
  ) as { workflow?: { statuses?: ManifestStatus[] } };
  return manifest.workflow?.statuses ?? [];
}

test("provisioning manifest workflow.statuses 覆盖流水线消费的自定义状态键", () => {
  const keys = new Set(loadManifestStatuses().map((s) => s.key));
  for (const required of CUSTOM_PIPELINE_STATUSES) {
    assert.ok(keys.has(required), `manifest workflow.statuses 缺少流水线消费键: ${required}（消费点见 clients/required-statuses.ts 锚点注释）`);
  }
});

test("manifest workflow.statuses 不重复声明 multica 内建状态键", () => {
  const builtins = new Set<string>(BUILTIN_STATUS_KEYS);
  for (const s of loadManifestStatuses()) {
    assert.ok(!builtins.has(s.key), `manifest workflow.statuses 声明了内建键: ${s.key}（内建键由 multica 自带，无需供给）`);
  }
});

test("manifest workflow.statuses 的 name 与 category 成对出现", () => {
  for (const s of loadManifestStatuses()) {
    assert.equal(Boolean(s.name), Boolean(s.category), `workflow.statuses ${s.key}: name/category 必须成对（新建状态的创建参数）`);
  }
});
