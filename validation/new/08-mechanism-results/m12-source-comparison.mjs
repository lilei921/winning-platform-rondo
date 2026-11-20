/** M12：只验证 CodeGraph 返回的指定源码片段与 TFS 固定 SHA；不臆造索引 Commit。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const { TfsClient } = await import(pathToFileURL('D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist/tfs/client.js').href);
const client = new TfsClient();
const commit = 'dc6ff47ff2f4e8f24c0db4c3efe88dcf92c5bf7a';
const file = '/winning-dps-df-frame-service/src/main/java/com/winning/dps/df/frame/service/uniauth/platform/PermissionPlatService.java';
const response = fs.readFileSync(path.join(out, 'M12-codegraph-response.txt'), 'utf8');
const selected = response.split('\n').flatMap(line => {
  const m = line.match(/^(\d+)\t(.*)$/);
  return m && +m[1] >= 111 && +m[1] <= 124 ? [{ line: +m[1], content: m[2] }] : [];
});
const url = new URL(`${client.config.serverUrl}/WiNEX%20DataFactory/_apis/git/repositories/winning-dps-df-frame/items`);
for (const [key, value] of Object.entries({ path: file, includeContent: 'true', 'versionDescriptor.versionType': 'commit', 'versionDescriptor.version': commit, 'api-version': '4.1' })) url.searchParams.set(key, value);
const res = await client.rawRequest(url.href, 'GET');
const item = JSON.parse(res.body);
const lines = item.content?.split(/\r?\n/) ?? [];
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const match = res.statusCode === 200 && item.commitId === commit && item.path === file && selected.length === 14 && selected.every(x => lines[x.line - 1] === x.content);
const data = { timestamp: new Date().toISOString(), mirror_path: '/root/winning-platform-monorepo/winning-dps-df-frame',
  mirror_head: commit, mirror_branch: 'dev', codegraph_version_from_last_log: '1.6.2', index_commit: null,
  http_status: res.statusCode, requested_commit: commit, returned_commit: item.commitId, object_id: item.objectId,
  path: file, full_api_file_sha256: hash(item.content), compared_lines: [111, 124],
  codegraph_fragment_sha256: hash(selected.map(x => x.content).join('\n')),
  api_fragment_sha256: hash(lines.slice(110, 124).join('\n')), source_fragment_match: match ? 'PASS' : 'FAIL',
  independent_api_read_without_mcp_dependency: res.statusCode === 200 ? 'PASS' : 'FAIL',
  index_commit_provenance: 'NOT_RUN: tool does not expose a committed index identity; timestamps are not commit proof',
  runtime_automatic_degradation: 'NOT_RUN: direct API read is proven, no production runtime outage injected', overall: 'NOT_RUN / PARTIAL_EVIDENCE' };
fs.writeFileSync(path.join(out, 'M12-source-comparison.json'), JSON.stringify(data, null, 2) + '\n');
console.log(JSON.stringify(data, null, 2));
if (!match) process.exitCode = 1;
