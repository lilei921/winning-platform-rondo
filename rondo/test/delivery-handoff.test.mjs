import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveHandoffTarget } from "../dist/commands/delivery/handoff.js";

const CLI = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const MOCK = fileURLToPath(new URL("./mock-multica.cjs", import.meta.url));

const AGENTS = [
  { id: "wayfinder-1", name: "Wayfinder Agent" },
  { id: "bug-1", name: "Bug Fix Agent", runtime_bound: true },
  { id: "lead-1", name: "Delivery Lead" },
];
const SQUADS = [{ id: "squad-1", name: "Delivery Squad", leader_id: "lead-1" }];

function initialState(type = "Bug") {
  return {
    issues: {
      "WNDF-T": {
        id: "issue-1", identifier: "WNDF-T", status: "in_progress",
        assignee_id: "wayfinder-1", assignee_type: "agent",
        metadata: { "tfs.id": "264601", "tfs.type": type },
      },
    },
    agents_list: AGENTS.map((a) => ({ ...a })),
    squads_list: SQUADS.map((s) => ({ ...s })),
    runs: {},
  };
}

function fixture(t, initial = initialState(), configPatch = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rondo-delivery-handoff-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  chmodSync(MOCK, 0o755);
  const statePath = join(dir, "state.json");
  const configPath = join(dir, "config.json");
  writeFileSync(statePath, JSON.stringify(initial));
  writeFileSync(configPath, JSON.stringify({
    runtime: {
      multica_cli: MOCK, workspace_id: "ws-1", delivery_squad_id: "squad-1",
      ...configPatch,
    },
  }));
  const read = () => JSON.parse(readFileSync(statePath, "utf8"));
  const write = (state) => writeFileSync(statePath, JSON.stringify(state));
  const run = (extraEnv = {}) => {
    const r = spawnSync(process.execPath, [CLI, "delivery", "handoff",
      "--config", configPath, "--issue", "WNDF-T"], {
      encoding: "utf8",
      env: { ...process.env, MOCK_STATE: statePath, ...extraEnv },
    });
    assert.equal(r.error, undefined, r.error?.message);
    let body;
    try { body = JSON.parse(r.stdout); }
    catch { assert.fail("invalid CLI JSON: " + r.stdout + "\n" + r.stderr); }
    return { code: r.status, body, stderr: r.stderr };
  };
  return { run, read, write, dir };
}

test("tfs.type -> target is deterministic and independent of change kind", () => {
  assert.deepEqual(resolveHandoffTarget("Bug"), { type: "agent", name: "Bug Fix Agent" });
  assert.deepEqual(resolveHandoffTarget("Requirement"), { type: "squad", name: "Delivery Squad" });
  assert.deepEqual(resolveHandoffTarget("需求"), { type: "squad", name: "Delivery Squad" });
  assert.equal(resolveHandoffTarget("Task"), null);
});

test("Bug: one atomic update, one Run, repeated handoff is NOOP", t => {
  const f = fixture(t);
  const a = f.run();
  assert.equal(a.code, 0, JSON.stringify(a.body));
  assert.equal(a.body.result, "PASS");
  assert.deepEqual(a.body.target, { type: "agent", name: "Bug Fix Agent", id: "bug-1" });
  const first = f.read();
  assert.equal(first.issues["WNDF-T"].status, "todo");
  assert.equal(first.issues["WNDF-T"].assignee_id, "bug-1");
  assert.equal(first.handoff_update_count, 1);
  assert.equal(first.runs["issue-1"].length, 1);
  const b = f.run();
  assert.equal(b.code, 0, JSON.stringify(b.body));
  assert.equal(b.body.result, "NOOP");
  assert.equal(f.read().handoff_update_count, 1);
});

for (const type of ["Requirement", "需求"]) {
  test(type + ": routes to Squad and checks Delivery Lead Run", t => {
    const state = initialState(type);
    state.issues["WNDF-T"].metadata["analysis.change_kind"] = "corrective";
    const f = fixture(t, state);
    const result = f.run();
    assert.equal(result.code, 0, JSON.stringify(result.body));
    assert.equal(result.body.target.type, "squad");
    assert.equal(result.body.target.id, "squad-1");
    assert.equal(f.read().runs["issue-1"][0].agent_id, "lead-1");
  });
}

test("unsupported type and non-Wayfinder owner cause zero write", t => {
  const f = fixture(t, initialState("Task"));
  const a = f.run();
  assert.equal(a.code, 2);
  assert.equal(a.body.result, "FAIL");
  assert.equal(f.read().handoff_update_count, undefined);
  const state = initialState("Bug");
  state.issues["WNDF-T"].assignee_id = "someone-else";
  f.write(state);
  const b = f.run();
  assert.equal(b.code, 2);
  assert.equal(f.read().handoff_update_count, undefined);
});

test("missing or mismatched target is UNKNOWN and causes zero write", t => {
  const state = initialState("Bug");
  state.agents_list = state.agents_list.filter(a => a.name !== "Bug Fix Agent");
  const f = fixture(t, state);
  assert.equal(f.run().code, 3);
  assert.equal(f.read().handoff_update_count, undefined);
  f.write(initialState("Requirement"));
  const g = fixture(t, initialState("Requirement"), { delivery_squad_id: "other-squad" });
  assert.equal(g.run().code, 3);
  assert.equal(g.read().handoff_update_count, undefined);
});

test("lost update response: recognize committed assignment, do not trigger again", t => {
  const f = fixture(t);
  const remaining = join(f.dir, "fault-count");
  writeFileSync(remaining, "1");
  const a = f.run({ MOCK_FAIL_MODE: "flaky_write", MOCK_FAIL_STATE: remaining });
  assert.equal(a.code, 0, JSON.stringify(a.body));
  assert.equal(a.body.mode, "recovered");
  assert.equal(f.read().handoff_update_count, 1);
  assert.equal(f.read().runs["issue-1"].length, 1);
});

test("assignment without observed Run is UNKNOWN and cannot retrigger", t => {
  const f = fixture(t);
  const a = f.run({ MOCK_SKIP_HANDOFF_RUN: "1" });
  assert.equal(a.code, 3, JSON.stringify(a.body));
  assert.equal(a.body.result, "UNKNOWN");
  const b = f.run();
  assert.equal(b.code, 3);
  assert.equal(f.read().handoff_update_count, 1);
  assert.equal(f.read().issues["WNDF-T"].assignee_id, "bug-1");
});

test("blocked + Wayfinder passes the CLI handoff state guard", t => {
  const state = initialState("Requirement");
  state.issues["WNDF-T"].status = "blocked";
  const f = fixture(t, state);
  const r = f.run();
  assert.equal(r.code, 0, JSON.stringify(r.body));
  assert.equal(r.body.result, "PASS");
  assert.equal(r.body.target.type, "squad");
  assert.equal(f.read().issues["WNDF-T"].status, "todo");
  assert.equal(f.read().handoff_update_count, 1);
  assert.equal(f.read().runs["issue-1"].length, 1);
});

test("unsupported terminal state cannot hand off", t => {
  const state = initialState("Requirement");
  state.issues["WNDF-T"].status = "unsupported";
  const f = fixture(t, state);
  const r = f.run();
  assert.equal(r.code, 2);
  assert.equal(r.body.result, "FAIL");
  assert.equal(f.read().handoff_update_count, undefined);
});

test("workspace must be explicit", t => {
  const f = fixture(t, initialState(), { workspace_id: "" });
  assert.equal(f.run().code, 3);
  assert.equal(f.read().handoff_update_count, undefined);
});

test("backlog: cannot bypass Wayfinder admission", t => {
  const state = initialState("Bug");
  state.issues["WNDF-T"].status = "backlog";
  const f = fixture(t, state);
  const a = f.run();
  assert.equal(a.code, 2);
  assert.equal(a.body.result, "FAIL");
  assert.equal(f.read().handoff_update_count, undefined);
});

test("completed handoff with later same-Agent runs remains NOOP", t => {
  const f = fixture(t);
  assert.equal(f.run().code, 0);
  const state = f.read();
  state.issues["WNDF-T"].status = "in_progress";
  state.runs["issue-1"].push({
    id: "run-later", issue_id: "issue-1", agent_id: "bug-1",
    attribution: { evidence: { kind: "issue_assignment", ref_id: "issue-1" } },
  });
  f.write(state);
  const result = f.run();
  assert.equal(result.code, 0, JSON.stringify(result.body));
  assert.equal(result.body.result, "NOOP");
  assert.equal(f.read().handoff_update_count, 1);
});

test("downstream quickly updates status; handoff reports observed status", t => {
  const f = fixture(t);
  const a = f.run({ MOCK_ADVANCE_HANDOFF_STATUS: "in_progress" });
  assert.equal(a.code, 0, JSON.stringify(a.body));
  assert.equal(a.body.result, "PASS");
  assert.equal(a.body.status, "in_progress");
  assert.equal(f.read().handoff_update_count, 1);
});

test("deprecated intake command is absent", t => {
  const f = fixture(t);
  const r = spawnSync(process.execPath, [CLI, "intake", "handoff"], {
    encoding: "utf8",
    env: { ...process.env },
  });
  assert.equal(r.status, 64);
  assert.equal(f.read().handoff_update_count, undefined);
});
