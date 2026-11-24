/** Publish committed execution artifacts and bind their remote SHA to the approved Analysis. */
import { Command } from "commander";
import { FailError, UnknownError } from "../../cli/errors.js";
import { ExitSignal, markLeafExecuted } from "../../cli/output.js";
import { resolveMulticaRuntime } from "../../clients/runtime-context.js";
import { readApprovedRepoMapping } from "./native-prepare.js";
import { loadConfig as loadTfsConfig } from "../../tfs/config.js";
import { git, gitOk } from "../../clients/git.js";
import { readGitTree, readGitBlob } from "../../clients/git-tree.js";
import { MulticaClient } from "../../clients/multica.js";
import { normalizeContractText } from "../delivery/contract-files.js";
import { readAnalysisArtifact, readAnalysisSource, type AnalysisSource } from "../analysis/source.js";
import { approvedChange, developmentPublication } from "./requirement-guard.js";
import { publishChange, requirementRoot } from "../runtime/root-git.js";

export const executionArtifact = /^(?:tasks\.md|design\.md)$/;
const contractFile = /^(?:\.openspec\.yaml|proposal\.md|tasks\.md|design\.md|specs\/.+\.md)$/;

/** Check the actual Git tree that would be published, including any compatible remote edits. */
export function checkPublishContract(root: string, source: AnalysisSource, candidate: string, minorDesign: boolean,
  previous?: string): void {
  gitOk(root, ["merge-base", "--is-ancestor", source.commit, candidate], "确认研发交付基于已批准的 Analysis Commit");
  const dir = "openspec/changes/" + source.change_ref;
  const approved = readGitTree(root, source.commit, dir);
  const result = readGitTree(root, candidate, dir);
  for (const file of new Set([...approved.keys(), ...result.keys()])) {
    const before = approved.get(file), after = result.get(file);
    if (executionArtifact.test(file) && after && !/^100(644|755)$/.test(after.mode)) {
      throw new FailError("研发工件必须为普通文件: " + file);
    }
    if (!contractFile.test(file)) continue;
    if (!before || !after || before.mode !== after.mode) throw new FailError("契约文件集合或类型偏离批准版本: " + file);
    if (before.oid === after.oid) continue;
    if (file === "design.md") {
      if (minorDesign) continue;
      if (previous && git(root, ["merge-base", "--is-ancestor", source.commit, previous]).status === 0 &&
          git(root, ["merge-base", "--is-ancestor", previous, candidate]).status === 0) {
        const confirmed = readGitTree(root, previous, dir).get(file);
        if (confirmed?.mode === after.mode && confirmed.oid === after.oid) continue;
      }
    }
    const approvedText = normalizeContractText(file, readGitBlob(root, before.oid).toString("utf8"));
    const publishedText = normalizeContractText(file, readGitBlob(root, after.oid).toString("utf8"));
    if (approvedText !== publishedText) throw new FailError("Change 契约修改超出研发授权: " + file);
  }
}

export function registerDevPublish(group: Command): void {
  group.command("publish").description("发布当前 Change 已提交的研发工件，登记远端交付 SHA")
    .requiredOption("--issue <key>").requiredOption("--change-ref <ref>")
    .option("--root-repo <path>").option("--minor-design", "确认仅细化非实质性 Design")
    .action(async (opts: { issue: string; changeRef: string; rootRepo?: string; minorDesign?: boolean }) => {
      markLeafExecuted();
      try {
        const runtime = resolveMulticaRuntime(), client = new MulticaClient(runtime);
        const sourceForMapping = readAnalysisSource(client.getIssue(opts.issue).metadata ?? {});
        const cfg = { runtime, registry: await readApprovedRepoMapping(sourceForMapping, loadTfsConfig().serverUrl) };
        const multica = new MulticaClient(cfg.runtime);
        const approved = await approvedChange(cfg, multica, opts.issue, opts.changeRef);
        const source = approved.source;
        if (source.commit !== sourceForMapping.commit || source.repo_url !== sourceForMapping.repo_url) throw new UnknownError("批准来源在读取映射期间变化");
        const root = requirementRoot(opts.rootRepo);
        const branch = source.branch;
        const original = approved.issue.metadata ?? {};
        const previous = developmentPublication(original);
        const previousCommit = previous?.analysis_commit === source.commit ? previous.commit : undefined;
        const published = await publishChange(root, opts.changeRef, approved.issue.identifier ?? approved.issue.id,
          executionArtifact, undefined, { repoUrl: source.repo_url, expectedBranch: branch, approvedCommit: source.commit,
            validateTree: commit => checkPublishContract(root, source, commit, opts.minorDesign === true, previousCommit) });
        const tasks = await readAnalysisArtifact({ ...source, commit: published.commit }, "tasks.md");
        const blob = gitOk(root, ["rev-parse", published.commit + ":" + tasks.path.slice(1)], "核对研发任务快照");
        if (tasks.object_id !== blob) throw new UnknownError("远端 tasks.md 与发布版本不一致");

        const receipt = JSON.stringify({ analysis_commit: source.commit, commit: published.commit });
        const rechecked = await approvedChange(cfg, multica, opts.issue, opts.changeRef);
        if (rechecked.issue.status !== approved.issue.status) throw new UnknownError("发布期间 Issue 状态变化");
        const current = rechecked.issue.metadata ?? {};
        if (current["analysis.source"] !== original["analysis.source"] ||
            current["analysis.human_approval"] !== original["analysis.human_approval"]) {
          throw new UnknownError("发布期间批准来源发生变化，停止登记交付");
        }
        if (current["dev.publication"] !== receipt) {
          if (current["dev.publication"] !== original["dev.publication"]) throw new UnknownError("研发交付记录已变化，请重新读取");
          if (previousCommit) {
            gitOk(root, ["merge-base", "--is-ancestor", previousCommit, published.commit], "防止旧回执覆盖较新的研发交付");
          }
          multica.setMetadata(approved.issue.id, "dev.publication", receipt);
        }
        const confirmed = multica.listMetadata(approved.issue.id);
        if (confirmed["dev.publication"] !== receipt || confirmed["analysis.source"] !== original["analysis.source"] ||
            confirmed["analysis.human_approval"] !== original["analysis.human_approval"]) {
          throw new UnknownError("研发交付记录或批准版本回读不一致");
        }
        process.stdout.write(JSON.stringify({ result: "PASS", change_ref: opts.changeRef, ...published }, null, 2) + "\n");
      } catch (e) {
        if (!(e instanceof FailError || e instanceof UnknownError)) throw e;
        process.stdout.write(JSON.stringify({ result: e instanceof FailError ? "FAIL" : "UNKNOWN", reason: e.message }, null, 2) + "\n");
        throw new ExitSignal(e instanceof FailError ? 2 : 3);
      }
    });
}
