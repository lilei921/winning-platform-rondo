// 独立 Worker 提供本机 TFS GET 桩；CLI 使用同步子进程时仍能服务请求。
import { Worker, isMainThread, workerData } from "node:worker_threads";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

if (!isMainThread) {
  const port = new Int32Array(workerData.port);
  const server = createServer((req, res) => {
    const state = JSON.parse(readFileSync(workerData.stateFile, "utf8"));
    const url = new URL(req.url, "http://localhost");
    const query = Object.fromEntries(url.searchParams);
    state.requests = [...(state.requests ?? []), { method: req.method, path: url.pathname, query }];
    writeFileSync(workerData.stateFile, JSON.stringify(state));
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "GET" || query["versionDescriptor.versionType"] !== "commit") {
      res.writeHead(400).end('{}'); return;
    }
    if (state.status) { res.writeHead(state.status).end('{}'); return; }
    const commit = query["versionDescriptor.version"];
    const path = query.path;
    const scope = query.scopePath;
    if (scope) {
      let files = [];
      if (state.remote) {
        const tree = spawnSync(workerData.git, ["--git-dir", state.remote, "ls-tree", "-r", "--name-only", commit, "--", scope.slice(1)], { encoding: "utf8" });
        if (tree.status !== 0) { res.writeHead(404).end("{}"); return; }
        files = tree.stdout.split(/\r?\n/).filter(Boolean).map(name => "/" + name);
      } else {
        files = Object.keys(state.versions?.[commit] ?? {}).filter(name => name.startsWith(scope + "/"));
      }
      const items = files.map(name => {
        const result = state.remote
          ? spawnSync(workerData.git, ["--git-dir", state.remote, "rev-parse", commit + ":" + name.slice(1)], { encoding: "utf8" })
          : null;
        return { path: name, commitId: commit,
          objectId: result?.stdout?.trim() || "a".repeat(40), isFolder: false };
      });
      res.end(JSON.stringify({ value: items }));
      return;
    }
    if (!path) { res.writeHead(400).end("{}"); return; }
    let content, objectId;
    if (state.remote) {
      // 从真实临时 bare 仓读取；未推送的 commit 不能由此桩读取成功。
      const result = spawnSync(workerData.git, ["--git-dir", state.remote, "show", `${commit}:${path.slice(1)}`], { encoding: "utf8" });
      if (result.status !== 0) { res.writeHead(404).end('{}'); return; }
      content = result.stdout;
      objectId = spawnSync(workerData.git, ["--git-dir", state.remote, "rev-parse", `${commit}:${path.slice(1)}`], { encoding: "utf8" }).stdout.trim();
    } else {
      const files = state.versions?.[commit];
      if (!files || !(path in files)) { res.writeHead(404).end('{}'); return; }
      content = files[path];
      const bytes = Buffer.from(content);
      objectId = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    }
    if (state.malformed) { res.end('not-json'); return; }
    if (state.rawResponse !== undefined) { res.end(state.rawResponse); return; }
    res.end(JSON.stringify({ path, commitId: commit, objectId, content, ...state.responseOverride }));
  });
  server.listen(0, "127.0.0.1", () => { Atomics.store(port, 0, server.address().port); Atomics.notify(port, 0); });
} else {
  // 主线程仅导出 fixture，不启动服务。
}

export function analysisTfsFixture(t, dir, initial, { requirementOrigin = false } = {}) {
  const locate = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["git"], { encoding: "utf8" });
  const realGit = locate.stdout.trim().split(/\r?\n/)[0];
  const stateFile = join(dir, "tfs-state.json");
  writeFileSync(stateFile, JSON.stringify(initial));
  const shared = new SharedArrayBuffer(4);
  const worker = new Worker(new URL(import.meta.url), { workerData: { port: shared, stateFile, git: realGit } });
  if (Atomics.wait(new Int32Array(shared), 0, 0, 10000) === "timed-out") throw new Error("TFS fixture 启动超时");
  t.after(() => worker.terminate());
  const server = `http://127.0.0.1:${new Int32Array(shared)[0]}`;
  const repoUrl = server + "/tfs/C/P/_git/R";
  const bin = join(dir, "git-bin");
  mkdirSync(bin);
  const script = join(bin, "git-fixture.cjs");
  // 仅替换远端地址发现边界；commit、push、rebase 均交给真实 Git/临时 bare 仓。
  writeFileSync(script, `const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
const query=args.join(' '), fetchUrl=process.env.MOCK_GIT_FETCH_URL, pushUrl=process.env.MOCK_GIT_PUSH_URL;
if (query === 'remote get-url --push --all origin' || (${JSON.stringify(requirementOrigin)} && query === 'remote get-url --push origin')) {
  process.stdout.write((pushUrl || ${JSON.stringify(repoUrl)})+'\\n');
} else if (${JSON.stringify(requirementOrigin)} && query === 'remote get-url origin') {
  process.stdout.write((fetchUrl || ${JSON.stringify(repoUrl)})+'\\n');
} else {
  const url = args[0] === 'push' ? pushUrl : ['fetch','ls-remote'].includes(args[0]) ? fetchUrl : undefined;
  if (url && args.includes('origin')) {
    const match=spawnSync(${JSON.stringify(realGit)},['config','--get-urlmatch','http.extraHeader',url],{encoding:'utf8'});
    if (!match.stdout.trim().startsWith('Authorization: Basic ')) { process.stderr.write('missing URL-scoped test credential'); process.exit(1); }
  }
  const r=spawnSync(${JSON.stringify(realGit)},args,{stdio:'inherit'});process.exit(r.status??1);
}
`);
  const launcher = join(bin, process.platform === "win32" ? "git.cmd" : "git");
  writeFileSync(launcher, process.platform === "win32"
    ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`);
  chmodSync(launcher, 0o755);
  return {
    repoUrl,
    env: { PATH: bin + delimiter + process.env.PATH, TFS_PAT: "fixture-only", TFS_SERVER_URL: server + "/tfs/C", TFS_CLI_CONFIG: "" },
    state: () => JSON.parse(readFileSync(stateFile, "utf8")),
    update: edit => { const state = JSON.parse(readFileSync(stateFile, "utf8")); edit(state); writeFileSync(stateFile, JSON.stringify(state)); },
  };
}
