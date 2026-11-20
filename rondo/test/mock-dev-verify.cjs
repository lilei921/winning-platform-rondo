#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const stFile = process.env.MOCK_VERIFY_STATE;
const st = JSON.parse(fs.readFileSync(stFile, "utf8"));
const write = () => fs.writeFileSync(stFile, JSON.stringify(st));
const value = (name) => args[args.indexOf(name) + 1];
const driftSource = () => {
  const source = JSON.parse(st.metadata["analysis.source"]);
  source.commit = "b".repeat(40);
  st.metadata["analysis.source"] = JSON.stringify(source);
  const approval = JSON.parse(st.metadata["analysis.human_approval"]);
  approval.source = source;
  st.metadata["analysis.human_approval"] = JSON.stringify(approval);
};

let output;
if (args[0] === "issue" && args[1] === "get") {
  output = ["sub-1", "WNDF-T-1"].includes(args[2]) ? st.sub : { id: "issue-1", identifier: "WNDF-T", project_id: "project-1", status: st.status || "in_progress", metadata: st.metadata };
} else if (args[0] === "issue" && args[1] === "create") {
  st.sub = { id: "sub-1", identifier: "WNDF-T-1", parent_issue_id: "issue-1", status: "backlog" };
  write();
  output = st.sub;
} else if (args[0] === "issue" && args[1] === "assign") {
  st.sub.assignee_id = "engineer-1";
  if (process.env.MOCK_VERIFY_DRIFT_ON_ASSIGN) driftSource();
  write();
  output = st.sub;
} else if (args[0] === "issue" && args[1] === "status") {
  st.sub.status = args[3];
  st.activations = (st.activations || 0) + 1;
  write();
  output = st.sub;
} else if (args[0] === "issue" && args[1] === "comment" && args[2] === "list") {
  output = (st.comments || ["approval-1"]).map((id) => ({ id }));
} else if (args[0] === "agent" && args[1] === "get") {
  // 模拟远端读取后、派发写入前有另一轮分析更新来源。
  if (process.env.MOCK_VERIFY_DRIFT_ON_AGENT) {
    driftSource();
    write();
  }
  output = { id: "engineer-1", name: "Engineer" };
} else if (args[0] === "issue" && args[1] === "metadata" && args[2] === "set") {
  const k = value("--key");
  if (process.env.MOCK_VERIFY_FAIL_KEY === k) {
    process.stderr.write("injected failure at " + k + "\n");
    process.exit(1);
  }
  st.metadata[k] = value("--value");
  if (k === "dev.dispatch" && process.env.MOCK_VERIFY_DRIFT_ON_DISPATCH) driftSource();
  write();
  output = { ok: true };
} else {
  process.stderr.write("unexpected mock call: " + args.join(" ") + "\n");
  process.exit(1);
}
process.stdout.write(JSON.stringify(output));
