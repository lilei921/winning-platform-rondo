/** 只通过当前已配置凭据进行 GET；报告只保存核对需要的公开事实，不序列化 client/config。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const out = path.dirname(fileURLToPath(import.meta.url));
const moduleBase = 'D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist';
const { TfsClient } = await import(pathToFileURL(`${moduleBase}/tfs/client.js`).href);
const client = new TfsClient();
const base = client.config.serverUrl;
const result = { timestamp: new Date().toISOString(), methods: ['GET'], credentials_present: Boolean(client.config.pat), records: [] };
async function get(suffix, label) {
  const r = await client.rawRequest(`${base}${suffix}`, 'GET');
  let body;
  try { body = JSON.parse(r.body); } catch { body = null; }
  result.records.push({ label, url: `${base}${suffix}`, status: r.statusCode, json: body !== null });
  if (r.statusCode !== 200 || body === null) throw new Error(`${label}: HTTP ${r.statusCode}; non_json=${body === null}`);
  return body;
}
try {
  const wi = await get('/_apis/wit/workitems/260986?$expand=relations&api-version=4.1', 'user_test_workitem');
  result.workitem = { id: wi.id, rev: wi.rev, fields: Object.fromEntries(Object.entries(wi.fields).filter(([key]) =>
    ['System.TeamProject', 'System.WorkItemType', 'System.Title', 'System.State', 'System.ChangedDate', 'Microsoft.VSTS.Scheduling.OriginalEstimate', 'Microsoft.VSTS.Scheduling.CompletedWork', 'Microsoft.VSTS.Scheduling.RemainingWork'].includes(key))),
    relations: (wi.relations ?? []).map(x => ({ rel: x.rel, url: x.url, name: x.attributes?.name })) };
} catch (e) { result.error = e.message; }
fs.writeFileSync(path.join(out, 'M10-test-workitem-readonly.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
