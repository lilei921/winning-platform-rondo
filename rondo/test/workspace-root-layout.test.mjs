import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveMulticaRoot } from "../dist/clients/repo-root.js";

test("workspace-config root resolution supports standalone and monorepo layouts", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "rondo-workspace-config-")));
  const previous = process.env.MULTICA_REPO_ROOT;
  t.after(() => {
    if (previous === undefined) delete process.env.MULTICA_REPO_ROOT;
    else process.env.MULTICA_REPO_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  });

  const standalone = join(root, "standalone");
  mkdirSync(join(standalone, "workspace-config"), { recursive: true });
  process.env.MULTICA_REPO_ROOT = standalone;
  assert.deepEqual(resolveMulticaRoot(), { multicaRoot: standalone, monorepoRoot: standalone });

  const monorepo = join(root, "monorepo");
  const multica = join(monorepo, "projects", "multica");
  mkdirSync(join(multica, "workspace-config"), { recursive: true });
  process.env.MULTICA_REPO_ROOT = monorepo;
  assert.deepEqual(resolveMulticaRoot(), { multicaRoot: multica, monorepoRoot: monorepo });

  process.env.MULTICA_REPO_ROOT = root;
  assert.throws(() => resolveMulticaRoot(), /workspace-config/);
});
