import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { publishChange } from "../dist/commands/runtime/root-git.js";

const repoUrl = "http://tfs.test/tfs/C/P/_git/root";
const changeA = "openspec/changes/change-a";
const changeB = "openspec/changes/change-b";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trimEnd();
}

function write(cwd, path, body) {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), body);
}

function commit(cwd, message) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-qm", message);
  return git(cwd, "rev-parse", "HEAD");
}

function fixture(t, changeRef = "change-a") {
  const dir = mkdtempSync(join(tmpdir(), "rondo-change-publish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "root"), bare = join(dir, "remote.git"), peer = join(dir, "peer");
  git(dir, "init", "--bare", "-b", "main", bare);
  git(dir, "init", "-b", "main", root);
  const identity = cwd => {
    git(cwd, "config", "user.name", "Rondo Test");
    git(cwd, "config", "user.email", "test@example.invalid");
  };
  identity(root);
  write(root, "docs/config/repo-context.yaml", "repos:\n  - repo_id: root\n    repo_url: " + repoUrl + "\n");
  write(root, changeA + "/tasks.md", "base A\n");
  write(root, changeA + "/old.md", "delete me\n");
  write(root, changeB + "/tasks.md", "base B\n");
  const base = commit(root, "baseline");
  git(root, "remote", "add", "origin", repoUrl);
  git(root, "push", bare, "main");
  git(dir, "clone", bare, peer);
  identity(peer);

  // Only the authenticated transport is replaced. Fetch, non-fast-forward rejection,
  // revisions and Git objects all come from a real, private bare repository.
  const remote = (url, args, cwd) => {
    assert.equal(url, repoUrl);
    assert.ok(["fetch", "push"].includes(args[0]), args.join(" "));
    const command = args[0] === "fetch"
      ? ["fetch", bare, "+refs/heads/main:refs/remotes/origin/main"]
      : args.map(arg => arg === "origin" ? bare : arg);
    return spawnSync("git", command, { cwd, encoding: "utf8" });
  };
  const publish = async (transport = remote, allowed, options = {}) => publishChange(root, changeRef, "TEST-A", allowed,
    undefined, { repoUrl, expectedBranch: "main", remote: transport, ...options });
  return { root, peer, bare, base, remote, publish };
}

function localState(cwd) {
  return [
    git(cwd, "rev-parse", "HEAD"),
    git(cwd, "status", "--porcelain=v1", "--untracked-files=all"),
    git(cwd, "diff", "--binary"),
    git(cwd, "diff", "--binary", "--cached"),
  ];
}

test("从交错历史及混合提交只发布本 Change 的已提交增删改，保留暂存区与工作树", async t => {
  const { root, bare, base, publish } = fixture(t);
  write(root, changeB + "/tasks.md", "B1\n");
  commit(root, "B first");
  write(root, changeA + "/tasks.md", "A1\n");
  commit(root, "A first");
  write(root, changeA + "/tasks.md", "A2\n");
  write(root, changeA + "/new.md", "new file\n");
  rmSync(join(root, changeA, "old.md"));
  write(root, changeB + "/tasks.md", "B2\n");
  write(root, "shared.md", "shared\n");
  commit(root, "A, B and shared together");
  write(root, changeA + "/tasks.md", "only staged\n");
  git(root, "add", changeA + "/tasks.md");
  write(root, changeA + "/tasks.md", "unstaged\n");
  write(root, changeA + "/untracked.md", "untracked\n");
  write(root, changeB + "/tasks.md", "dirty B\n");
  const before = localState(root);
  const { commit: published } = await publish();
  assert.equal(git(bare, "rev-parse", "main"), published);
  assert.equal(git(bare, "show", "-s", "--format=%P", published), base);
  assert.deepEqual(git(bare, "diff", "--name-status", "--no-renames", base, published).split("\n"),
    ["A\t" + changeA + "/new.md", "D\t" + changeA + "/old.md", "M\t" + changeA + "/tasks.md"]);
  assert.equal(git(bare, "show", published + ":" + changeA + "/tasks.md"), "A2");
  assert.equal(git(bare, "show", published + ":" + changeA + "/new.md"), "new file");
  assert.deepEqual(localState(root), before);
  assert.equal(readFileSync(join(root, changeA, "untracked.md"), "utf8"), "untracked\n");
});

test("推送遇到远端推进时，合并同一文件的兼容改动并保留本地历史", async t => {
  const { root, bare, peer, remote, publish } = fixture(t);
  const path = changeA + "/tasks.md";
  const lines = Array.from({ length: 20 }, (_, i) => "line " + (i + 1)).join("\n") + "\n";
  write(peer, path, lines);
  commit(peer, "common text");
  git(peer, "push", "origin", "main");
  git(root, "pull", "--ff-only", bare, "main");
  write(root, path, lines.replace("line 1\n", "local first line\n"));
  const local = commit(root, "local line");
  write(peer, path, lines.replace("line 20\n", "remote last line\n"));
  write(peer, "remote.md", "concurrent change\n");
  const competing = commit(peer, "concurrent publication");
  let pushes = 0;
  const { commit: published } = await publish((url, args, cwd) => {
    if (args[0] === "push" && pushes++ === 0) git(peer, "push", "origin", "main");
    return remote(url, args, cwd);
  });
  assert.equal(git(root, "rev-parse", "HEAD"), local);
  assert.equal(git(bare, "rev-parse", "main"), published);
  assert.equal(git(bare, "rev-parse", published + "^"), competing);
  assert.equal(git(bare, "show", published + ":" + path),
    lines.replace("line 1\n", "local first line\n").replace("line 20\n", "remote last line\n").trimEnd());
  assert.equal(git(bare, "show", published + ":remote.md"), "concurrent change");
});

test("同一行冲突报告文件及双方内容，保留远端版本、本地提交和 WIP", async t => {
  const { root, bare, peer, publish } = fixture(t);
  const path = changeA + "/tasks.md";
  write(root, path, "local wording\n");
  commit(root, "local");
  write(root, changeB + "/tasks.md", "staged B\n");
  git(root, "add", changeB + "/tasks.md");
  write(peer, path, "remote wording\n");
  const competing = commit(peer, "concurrent line");
  git(peer, "push", "origin", "main");
  const before = localState(root);
  await assert.rejects(() => publish(), error => {
    assert.match(error.message, /tasks\.md/);
    assert.match(error.message, /local wording/);
    assert.match(error.message, /remote wording/);
    return true;
  });
  assert.equal(git(bare, "rev-parse", "main"), competing);
  assert.deepEqual(localState(root), before);
});

test("回执及回读丢失后，远端又新增其他 Change，重试找回原 SHA", async t => {
  const { root, bare, peer, remote, publish } = fixture(t);
  write(root, changeA + "/tasks.md", "published A\n");
  write(root, changeB + "/private.md", "unpublished B\n");
  const localSource = commit(root, "mixed A and B");
  let lost = false;
  const unreachable = { status: 1, stdout: "", stderr: "connection lost" };
  await assert.rejects(() => publish((url, args, cwd) => {
    if (lost) return unreachable;
    const result = remote(url, args, cwd);
    if (args[0] === "push" && result.status === 0) {
      lost = true;
      return unreachable;
    }
    return result;
  }));
  assert.equal(lost, true);
  const original = git(bare, "rev-parse", "main");
  git(peer, "pull", "--ff-only", "origin", "main");
  write(peer, changeB + "/tasks.md", "other published B\n");
  const advanced = commit(peer, "publish B\n\nRondo-Source: change-a " + localSource);
  git(peer, "push", "origin", "main");
  write(root, changeB + "/local.md", "other local work\n");
  commit(root, "B local after losing A receipt");
  const recovered = await publish((url, args, cwd) => {
    assert.notEqual(args[0], "push", "重复运行应从远端历史回读");
    return remote(url, args, cwd);
  });
  assert.equal(recovered.commit, original);
  assert.equal(git(bare, "rev-parse", "main"), advanced);
});

test("同一常驻分支再次发布可撤销前次变更", async t => {
  const { root, bare, publish } = fixture(t);
  const path = changeA + "/tasks.md";
  write(root, path, "published\n");
  write(root, changeB + "/private.md", "unpublished B\n");
  commit(root, "edit A and B");
  const first = (await publish()).commit;
  write(root, path, "base A\n");
  commit(root, "revert edit A");
  const second = (await publish()).commit;
  assert.equal(git(bare, "rev-parse", "main"), second);
  assert.equal(git(bare, "rev-parse", second + "^"), first);
  assert.equal(git(bare, "show", second + ":" + path), "base A");
});

test("研发工件白名单检查已经提交的差异", async t => {
  const { root, base, bare, remote, publish } = fixture(t);
  write(root, changeA + "/tasks.md", "progress\n");
  write(root, changeA + "/proposal.md", "unapproved change\n");
  commit(root, "mixed allowed and forbidden files");
  await assert.rejects(() => publish(remote, /^tasks\.md$/));
  assert.equal(git(bare, "rev-parse", "main"), base);
});

test("新增和完整删除已提交 Change 时，目录内未提交文件留在本地", async t => {
  const ref = "new-change", path = "openspec/changes/" + ref;
  const { root, base, bare, publish } = fixture(t, ref);
  write(root, path + "/tasks.md", "new change\n");
  commit(root, "add change");
  const created = (await publish()).commit;
  assert.equal(git(bare, "rev-parse", created + "^"), base);
  assert.equal(git(bare, "show", created + ":" + path + "/tasks.md"), "new change");
  rmSync(join(root, path), { recursive: true });
  commit(root, "delete change");
  write(root, path + "/draft.md", "uncommitted draft\n");
  const before = localState(root);
  const removed = (await publish()).commit;
  assert.equal(git(bare, "rev-parse", removed + "^"), created);
  assert.equal(git(bare, "ls-tree", removed, "--", path), "");
  assert.equal((await publish()).commit, removed);
  assert.deepEqual(localState(root), before);
  assert.equal(readFileSync(join(root, path + "/draft.md"), "utf8"), "uncommitted draft\n");
});

test("白名单按实际 Git 文件名校验，保留前置空格", async t => {
  const { root, base, bare, remote, publish } = fixture(t);
  write(root, changeA + "/ tasks.md", "unapproved file\n");
  commit(root, "file name with space");
  await assert.rejects(() => publish(remote, /^tasks\.md$/));
  assert.equal(git(bare, "rev-parse", "main"), base);
});

test("远端并发重命名时，最终发布差异仍限定在研发许可文件内", async t => {
  const { root, peer, bare, remote, publish } = fixture(t);
  const original = changeA + "/evidence.json", renamed = changeA + "/notes.json";
  write(peer, original, '{"review": "pending"}\n');
  commit(peer, "baseline evidence");
  git(peer, "push", "origin", "main");
  git(root, "pull", "--ff-only", bare, "main");
  write(root, original, '{"review": "done"}\n');
  commit(root, "update authorized evidence");
  git(peer, "mv", original, renamed);
  const competing = commit(peer, "rename evidence");
  git(peer, "push", "origin", "main");
  await assert.rejects(() => publish(remote, /^evidence\.json$/));
  assert.equal(git(bare, "rev-parse", "main"), competing);
  assert.equal(git(bare, "show", competing + ":" + renamed), '{"review": "pending"}');
});

test("跨 Runtime 分叉时，Engineer 从批准 SHA 取回工件并独立发布任务进度", async t => {
  for (const mode of ["仅取回 Tasks", "取回全部批准工件", "更改未授权 Proposal"]) {
    await t.test(mode, async t => {
      const ref = "approved-on-peer", path = "openspec/changes/" + ref;
      const { root, bare, peer, remote, publish } = fixture(t, ref);
      write(root, changeB + "/tasks.md", "unfinished B\n");
      commit(root, "local branch diverged before A");
      const tasks = Array.from({ length: 20 }, (_, i) => "- [ ] " + (i + 1) + " Task").join("\n") + "\n";
      const approvedFiles = new Map([
        ["proposal.md", "# Approved A\n"], [".openspec.yaml", "schema: corrective-change\n"],
        ["specs/a/spec.md", "approved specification\n"], ["tasks.md", tasks],
      ]);
      for (const [file, body] of approvedFiles) write(peer, path + "/" + file, body);
      const approvedCommit = commit(peer, "approved analysis on another runtime");
      git(peer, "push", "origin", "main");
      git(root, "fetch", bare, "main");
      for (const file of approvedFiles.keys()) {
        if (mode !== "仅取回 Tasks" || file === "tasks.md") {
          const body = git(root, "show", approvedCommit + ":" + path + "/" + file) + "\n";
          write(root, path + "/" + file, file === "tasks.md" ? body.replace("[ ] 1 ", "[x] 1 ") : body);
        }
      }
      if (mode === "更改未授权 Proposal") write(root, path + "/proposal.md", "different proposal\n");
      write(root, path + "/evidence.json", '{"passed":true}\n');
      const local = commit(root, "engineer updates progress");
      write(peer, path + "/tasks.md", tasks.replace("[ ] 20 ", "[x] 20 "));
      const competing = commit(peer, "compatible concurrent progress");
      git(peer, "push", "origin", "main");

      const publishDev = () => publish(remote, /^(?:tasks\.md|evidence\.json)$/, { approvedCommit });
      if (mode === "更改未授权 Proposal") {
        await assert.rejects(publishDev);
        assert.equal(git(bare, "rev-parse", "main"), competing);
      } else {
        const result = await publishDev();
        assert.equal(git(bare, "rev-parse", "main"), result.commit);
        assert.equal(git(bare, "rev-parse", result.commit + "^"), competing);
        for (const [file, body] of approvedFiles) {
          const expected = file === "tasks.md" ? body.replace("[ ] 1 ", "[x] 1 ").replace("[ ] 20 ", "[x] 20 ") : body;
          assert.equal(git(bare, "show", result.commit + ":" + path + "/" + file), expected.trimEnd());
        }
        assert.equal(git(bare, "show", result.commit + ":" + path + "/evidence.json"), '{"passed":true}');
      }
      assert.equal(git(root, "rev-parse", "HEAD"), local);
      assert.equal(git(bare, "show", approvedCommit + ":" + path + "/tasks.md"), tasks.trimEnd());
    });
  }
});

test("批准前双方已有的 Evidence 按原始内容合并", async t => {
  for (const sameLine of [false, true]) {
    await t.test(sameLine ? "同一行的实际冲突" : "不同段落均保留", async t => {
      const { root, peer, bare, remote, publish } = fixture(t);
      const path = changeA + "/evidence.json";
      const baseline = JSON.stringify(Array.from({ length: 15 }, (_, i) => "check-" + i), null, 2) + "\n";
      const tasks = changeA + "/tasks.md", pending = "- [ ] 1.1 Verify\n- [ ] 1.2 Review\n";
      write(peer, tasks, pending);
      write(peer, path, baseline);
      commit(peer, "shared evidence before approval");
      git(peer, "push", "origin", "main");
      git(root, "pull", "--ff-only", bare, "main");
      const approved = baseline.replace('"check-0"', '"approved first"');
      write(peer, tasks, pending.replace("[ ] 1.2", "[x] 1.2"));
      write(peer, path, approved);
      const approvedCommit = commit(peer, "analysis approval updates first check");
      git(peer, "push", "origin", "main");
      const target = sameLine ? '"check-0"' : '"check-14"';
      write(root, tasks, pending.replace("[ ] 1.1", "[x] 1.1"));
      write(root, path, baseline.replace(target, '"locally verified"'));
      const local = commit(root, "local verification based on existing evidence");
      const publishDev = () => publish(remote, /^(?:tasks\.md|evidence\.json)$/, { approvedCommit });
      if (sameLine) {
        await assert.rejects(publishDev, error => {
          assert.match(error.message, /evidence\.json/);
          assert.doesNotMatch(error.message, /tasks\.md/);
          assert.match(error.message, /approved first/);
          assert.match(error.message, /locally verified/);
          return true;
        });
        assert.equal(git(bare, "rev-parse", "main"), approvedCommit);
      } else {
        const result = await publishDev();
        assert.equal(git(bare, "rev-parse", result.commit + "^"), approvedCommit);
        assert.equal(git(bare, "show", result.commit + ":" + tasks), pending.replaceAll("[ ]", "[x]").trimEnd());
        assert.equal(git(bare, "show", result.commit + ":" + path), approved.replace(target, '"locally verified"').trimEnd());
      }
      assert.equal(git(root, "rev-parse", "HEAD"), local);
      assert.equal(git(bare, "show", approvedCommit + ":" + path), approved.trimEnd());
    });
  }
});

test("批准与本机独立新增同名 Evidence，双方内容不同时报告 add/add 冲突", async t => {
  const { root, peer, bare, remote, publish } = fixture(t);
  const path = changeA + "/evidence.json";
  write(peer, path, '{"check":"approved evidence"}\n');
  const approvedCommit = commit(peer, "approved evidence created on peer");
  git(peer, "push", "origin", "main");
  write(root, path, '{"check":"local evidence"}\n');
  const local = commit(root, "independently add evidence");
  await assert.rejects(() => publish(remote, /^evidence\.json$/, { approvedCommit }), error => {
    assert.match(error.message, /evidence\.json/);
    assert.match(error.message, /approved evidence/);
    assert.match(error.message, /local evidence/);
    return true;
  });
  assert.equal(git(bare, "rev-parse", "main"), approvedCommit);
  assert.equal(git(root, "rev-parse", "HEAD"), local);
});

test("两端内容已等价时只登记一次实际发布 SHA，后续删除保留其他远端文件", async t => {
  const { root, peer, bare, base, remote, publish } = fixture(t);
  const file = changeA + "/evidence.json", concurrent = changeA + "/evidence-other.json";
  write(root, file, '{"pass":true}\n');
  write(root, changeB + "/private.md", "local B");
  const source = commit(root, "mixed local confirmation");
  write(peer, file, '{"pass":true}\n');
  write(peer, concurrent, "independent result");
  const equivalent = commit(peer, "same confirmation independently");
  git(peer, "push", "origin", "main");

  const allowed = /^evidence\.json$/;
  let pushes = 0;
  const transport = (url, args, cwd) => {
    if (args[0] === "push") pushes++;
    return remote(url, args, cwd);
  };
  const publishDev = () => publish(transport, allowed, { approvedCommit: base });
  const first = await publishDev();
  assert.equal(pushes, 1);
  assert.equal(first.committed, 0);
  assert.equal(git(bare, "rev-parse", first.commit + "^"), equivalent);
  assert.equal(git(bare, "diff", "--name-only", equivalent, first.commit), "");
  assert.equal(git(bare, "show", "-s", "--format=%(trailers:key=Rondo-Source,valueonly)", first.commit), "change-a " + source);

  git(peer, "pull", "--ff-only");
  write(peer, changeB + "/progress.md", "published B");
  commit(peer, "B advances after receipt");
  git(peer, "push", "origin", "main");
  const retry = await publishDev();
  assert.equal(retry.commit, first.commit);
  // A Runtime that has fetched the publication has no copy of the unpublished local source.
  git(peer, "remote", "set-url", "origin", repoUrl);
  const fromPeer = await publishChange(peer, "change-a", "TEST-A", allowed, undefined,
    { repoUrl, expectedBranch: "main", remote: transport, approvedCommit: base });
  assert.equal(fromPeer.commit, first.commit);
  assert.equal(pushes, 1);

  rmSync(join(root, file));
  commit(root, "withdraw invalid evidence");
  const deletion = await publishDev();
  assert.equal(pushes, 2);
  assert.equal(git(bare, "diff", "--name-status", deletion.commit + "^", deletion.commit), "D\t" + file);
  assert.equal(git(bare, "show", deletion.commit + ":" + concurrent), "independent result");
});

test("并发 Fetch 的本地跟踪分支 CAS 失败可恢复，凭据错误立即返回", async t => {
  const { root, remote, publish } = fixture(t);
  write(root, changeA + "/new.md", "new");
  commit(root, "change A");
  let attempts = 0;
  const transient = { status: 1, stdout: "", stderr: "error: fetching ref refs/remotes/origin/main failed: incorrect old value provided" };
  const result = await publish((url, args, cwd) => {
    if (args[0] === "fetch" && ++attempts === 1) return transient;
    return remote(url, args, cwd);
  });
  assert.ok(result.pushed);
  assert.equal(attempts, 3); // Contended fetch, retry, post-push readback.
  let denied = 0;
  await assert.rejects(() => publish(() => {
    denied++;
    return { status: 128, stdout: "", stderr: "Authentication failed" };
  }), /Authentication failed/);
  assert.equal(denied, 1);
});
