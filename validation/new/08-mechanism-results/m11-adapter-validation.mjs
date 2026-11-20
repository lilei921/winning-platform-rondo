/** M11：复用既有 T11 固定提交，只读回归编码；异常响应在进程内模拟，不写服务器。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const dist = 'D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist';
const { TfsClient } = await import(pathToFileURL(`${dist}/tfs/client.js`).href);
const { readAnalysisArtifact } = await import(pathToFileURL(`${dist}/commands/analysis/source.js`).href);
const fixture = JSON.parse(fs.readFileSync(path.resolve(out, '../../tfs-git-api-t11-paths-2026-11-12.evidence.json'), 'utf8').replace(/^\uFEFF/, ''));
const client = new TfsClient();
const data = { timestamp: new Date().toISOString(), credentials_present: Boolean(client.config.pat),
  real_reads: [], simulated_errors: [], low_privilege_identity: 'NOT_RUN', http_policy_approval: 'NOT_RUN' };
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
try {
  for (const test of fixture.cases) {
    const url = new URL(`${client.config.serverUrl}/_apis/git/repositories/${fixture.repositoryId}/items`);
    for (const [key, value] of Object.entries({ path: test.path, includeContent: 'true', 'versionDescriptor.versionType': 'commit', 'versionDescriptor.version': fixture.editedCommit, 'api-version': '4.1' })) url.searchParams.set(key, value);
    const res = await client.rawRequest(url.href, 'GET');
    let item;
    try { item = JSON.parse(res.body); } catch { item = null; }
    const actualHash = typeof item?.content === 'string' ? hash(item.content) : null;
    data.real_reads.push({ id: test.id, url: url.href, method: 'GET', status: res.statusCode, requested_commit: fixture.editedCommit,
      actual_commit: item?.commitId, path: item?.path, object_id: item?.objectId, expected_sha256: test.editedSha256,
      actual_sha256: actualHash, result: res.statusCode === 200 && item?.commitId === fixture.editedCommit && item?.path === test.path && actualHash === test.editedSha256 ? 'PASS' : 'FAIL' });
  }
  const source = { repo_url: `${client.config.serverUrl}/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo`,
    branch: 'fixture', commit: 'a'.repeat(40), change_ref: 'fixture' };
  const original = TfsClient.prototype.rawRequest;
  try {
    for (const status of [404, 401, 403, 200]) {
      let calls = 0;
      TfsClient.prototype.rawRequest = async () => { calls++; return { statusCode: status, body: '<html>fixture non-JSON</html>' }; };
      try { await readAnalysisArtifact(source, 'tasks.md'); data.simulated_errors.push({ status, result: 'FAIL', reason: 'unexpected success' }); }
      catch (e) { data.simulated_errors.push({ status, calls, error_type: e.constructor.name, reason: e.message,
        result: calls === 1 && (status === 404 ? e.constructor.name === 'FailError' : e.constructor.name === 'UnknownError') ? 'PASS' : 'FAIL' }); }
    }
  } finally { TfsClient.prototype.rawRequest = original; }
  data.adapter_status = [...data.real_reads, ...data.simulated_errors].every(x => x.result === 'PASS') ? 'PASS' : 'FAIL';
} catch (e) { data.adapter_status = 'FAIL'; data.error = e.message; }
data.overall_M11 = 'NOT_RUN: permission and transport policy gates lack approved identity/policy';
fs.writeFileSync(path.join(out, 'M11-adapter-evidence.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data, null, 2));
if (data.adapter_status !== 'PASS') process.exitCode = 1;
