/** M08：历史 completed PR 与已发布 Evidence 的独立 Candidate 核对，全程 GET。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const { TfsClient } = await import(pathToFileURL('D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist/tfs/client.js').href);
const client = new TfsClient();
const base = client.config.serverUrl;
const data = { timestamp: new Date().toISOString(), requests: [], assertions: [] };
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
async function get(url, label) {
  const r = await client.rawRequest(url, 'GET');
  let parsed;
  try { parsed = JSON.parse(r.body); } catch { parsed = null; }
  data.requests.push({ label, method: 'GET', url, status: r.statusCode, json: parsed !== null });
  if (r.statusCode !== 200 || !parsed) throw new Error(`${label}: HTTP ${r.statusCode}`);
  return parsed;
}
function check(name, condition) {
  data.assertions.push({ name, result: condition ? 'PASS' : 'FAIL' });
  if (!condition) throw new Error(name);
}
try {
  const prefix = `${base}/WiNEX%20DataFactory/_apis/git/repositories/winning-dps-df-frame`;
  const pr = await get(`${prefix}/pullrequests/3532?api-version=4.1`, 'raw_completed_pr');
  data.pr = { id: pr.pullRequestId, repository_id: pr.repository.id, status: pr.status, mergeStatus: pr.mergeStatus,
    sourceRefName: pr.sourceRefName, targetRefName: pr.targetRefName, lastMergeSourceCommit: pr.lastMergeSourceCommit,
    lastMergeCommit: pr.lastMergeCommit, closedDate: pr.closedDate };
  const artifactPath = '/openspec/changes/archive/2026-10-29-tfs-260987-unified-permission-menu-language/evidence.json';
  const rootCommit = 'e21292336401e74eb0e58d29776e9b9815a46d59';
  const bodies = [];
  for (const version of ['4.0', '4.1']) {
    const url = new URL(`${base}/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_apis/git/repositories/winning-platform-monorepo/items`);
    for (const [key, value] of Object.entries({ path: artifactPath, includeContent: 'true', 'versionDescriptor.versionType': 'commit', 'versionDescriptor.version': rootCommit, 'api-version': version })) url.searchParams.set(key, value);
    const item = await get(url.href, `published_evidence_api_${version}`);
    check(`fixed_commit_${version}`, item.commitId === rootCommit && item.path === artifactPath && typeof item.content === 'string');
    const evidence = JSON.parse(item.content);
    const candidate = evidence.commits.find(c => c.branch === 'feat/260987');
    check(`candidate_present_${version}`, /^[0-9a-f]{40}$/.test(candidate?.sha));
    bodies.push(item.content);
    data[`evidence_${version}`] = { source_root_commit: rootCommit, path: item.path, object_id: item.objectId,
      sha256: hash(item.content), candidate_commit: candidate.sha, candidate_branch: candidate.branch };
  }
  check('api_4_0_4_1_same_bytes', bodies[0] === bodies[1]);
  const cli = JSON.parse(fs.readFileSync(path.join(out, 'M08-pr-3532-get.json'), 'utf8').replace(/^\uFEFF/, ''));
  check('completed_pr', pr.status === 'completed' && cli.status === 'completed');
  check('rondo_exact_candidate_match', cli.sourceCommitId === data['evidence_4.1'].candidate_commit);
  check('rondo_maps_lastMergeSourceCommit', cli.sourceCommitId === pr.lastMergeSourceCommit.commitId);
  check('merge_commit_not_used_as_candidate', cli.mergeCommitId === pr.lastMergeCommit.commitId && cli.mergeCommitId !== cli.sourceCommitId);
  data.result = 'PASS';
} catch (e) { data.result = 'FAIL'; data.error = e.message; process.exitCode = 1; }
fs.writeFileSync(path.join(out, 'M08-pr-source-audit.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data, null, 2));
