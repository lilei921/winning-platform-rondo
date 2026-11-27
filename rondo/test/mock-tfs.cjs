#!/usr/bin/env node
// 桩 tfs CLI（tfs reconcile-workitem 测试用）：
//   workitem query                                            → 输出 MOCK_TFS_QUERY_FILE 的 JSON 数组
//   workitem download-attachment --url <u> --out <dir> [--name <n>]
//                                                    → 落一个伪附件文件并输出 {path,name}
// rondo 的 tfsCliPrefix 推导要求 query_command 含 "workitem query" 子命令段，
// 推荐配置形式：["node", "<本文件>", "workitem", "query"]。
const fs = require("fs");
const path = require("path");
const a = process.argv.slice(2);
function flag(name) { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : undefined; }

if (a[0] === "workitem" && a[1] === "query") {
  process.stdout.write(fs.readFileSync(process.env.MOCK_TFS_QUERY_FILE, "utf8"));
} else if (a[0] === "workitem" && a[1] === "download-attachment") {
  // 同步回归：按来源 URL 注入下载失败或损坏的成功响应，不连接真实 TFS。
  const failures = process.env.MOCK_TFS_DOWNLOAD_RESPONSES
    ? JSON.parse(process.env.MOCK_TFS_DOWNLOAD_RESPONSES) : {};
  const injected = failures[flag("--url")];
  if (injected) {
    process.stdout.write(JSON.stringify(injected.body));
    process.exit(injected.exit ?? 0);
  }
  const out = flag("--out");
  const name = flag("--name") || "att.bin";
  fs.mkdirSync(out, { recursive: true });
  const p = path.join(out, name);
  fs.writeFileSync(p, `mock attachment for ${flag("--url")}`);
  process.stdout.write(JSON.stringify({ path: p, name, size: fs.statSync(p).size, decompressed: false }));
} else {
  process.stderr.write("mock-tfs: unexpected args: " + a.join(" ") + "\n");
  process.exit(1);
}
