import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { once } from 'node:events';
import { cmdWorkItemDownloadAttachment } from './workitem.js';
import { FailError } from '../client.js';

const GUID = '015244e4-6152-40db-a6b9-e2e7794ac865';
const PNG = Buffer.from('89504e470d0a1a0a0000000049454e44ae426082', 'hex');

/** 使用本地 HTTP 服务验证真实请求路径；不会连接 TFS，也不会读取真实 PAT。 */
async function fixture(t: TestContext, handler: http.RequestListener) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address() as import('node:net').AddressInfo;
  const collection = `http://127.0.0.1:${addr.port}/tfs/Collection`;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rondo-download-test-'));
  const savedServer = process.env.TFS_SERVER_URL;
  const savedPat = process.env.TFS_PAT;
  process.env.TFS_SERVER_URL = collection;
  process.env.TFS_PAT = 'fixture-only';
  t.after(async () => {
    if (savedServer === undefined) delete process.env.TFS_SERVER_URL;
    else process.env.TFS_SERVER_URL = savedServer;
    if (savedPat === undefined) delete process.env.TFS_PAT;
    else process.env.TFS_PAT = savedPat;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(out, { recursive: true, force: true });
  });
  return { collection, out };
}

test('跨项目内嵌图片使用集合级附件 API，保留 gzip 自动解压', async (t) => {
  const requests: string[] = [];
  const f = await fixture(t, (req, res) => {
    requests.push(req.url!);
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname !== `/tfs/Collection/_apis/wit/attachments/${GUID}`) {
      res.writeHead(404); res.end('wrong project route'); return;
    }
    assert.equal(url.searchParams.get('api-version'), '4.1');
    assert.equal(url.searchParams.get('download'), 'true');
    assert.equal(url.searchParams.get('fileName'), 'tmp4792.png');
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(zlib.gzipSync(PNG));
  });
  const result = await cmdWorkItemDownloadAttachment({
    url: `${f.collection}/29dfa130-8e3b-40c3-bc8b-5eaa3f5be88d/_apis/wit/attachments?FileNameGUID=${GUID}&amp;FileName=tmp4792.png`,
    out: f.out,
    name: 'tmp4792.png',
  }) as { path: string; name: string; size: number; decompressed: boolean };
  assert.equal(requests.length, 1);
  assert.deepEqual(fs.readFileSync(result.path), PNG);
  assert.equal(result.name, 'tmp4792.png');
  assert.equal(result.size, PNG.length);
  assert.equal(result.decompressed, true);
});

test('404 保留下载阶段与规范 URL，不生成附件文件', async (t) => {
  const f = await fixture(t, (_req, res) => { res.writeHead(404); res.end('missing'); });
  await assert.rejects(cmdWorkItemDownloadAttachment({
    url: `${f.collection}/wrong-project/_apis/wit/attachments/${GUID}?fileName=gone.png`, out: f.out,
  }), (error: unknown) => {
    assert.ok(error instanceof FailError);
    assert.match(error.message, /HTTP 404/);
    assert.ok(error.message.includes(`${f.collection}/_apis/wit/attachments/${GUID}`));
    return true;
  });
  assert.deepEqual(fs.readdirSync(f.out), []);
});

test('外站或其他 collection 的附件拒绝发送 PAT', async (t) => {
  let requests = 0;
  const f = await fixture(t, (_req, res) => { requests++; res.end(PNG); });
  for (const url of [
    `${f.collection.replace('127.0.0.1', 'localhost')}/_apis/wit/attachments/${GUID}`,
    `${f.collection.replace('/Collection', '/Other')}/_apis/wit/attachments/${GUID}`,
    `${f.collection}-other/_apis/wit/attachments/${GUID}`,
  ]) {
    await assert.rejects(cmdWorkItemDownloadAttachment({ url, out: f.out }), FailError);
  }
  assert.equal(requests, 0);
  assert.deepEqual(fs.readdirSync(f.out), []);
});
