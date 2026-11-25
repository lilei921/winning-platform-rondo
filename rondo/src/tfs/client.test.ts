import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import { once } from 'node:events';
import { TfsClient } from './client.js';

test('rawRequest 完整解码跨 HTTP Chunk 的 UTF-8 字符', async (t) => {
  const payload = { content: '作业迁移日志、参数值😀' };
  const expected = JSON.stringify(payload);
  const bytes = Buffer.from(expected, 'utf8');
  const punctuation = bytes.indexOf(Buffer.from('、'));
  const emoji = bytes.indexOf(Buffer.from('😀'));
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.write(bytes.subarray(0, punctuation + 1));
    res.write(bytes.subarray(punctuation + 1, emoji + 2));
    res.end(bytes.subarray(emoji + 2));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as import('node:net').AddressInfo;
  const url = `http://127.0.0.1:${port}/tfs/Collection`;
  const savedServer = process.env.TFS_SERVER_URL;
  const savedPat = process.env.TFS_PAT;
  process.env.TFS_SERVER_URL = url;
  process.env.TFS_PAT = 'fixture-only';
  t.after(async () => {
    if (savedServer === undefined) delete process.env.TFS_SERVER_URL;
    else process.env.TFS_SERVER_URL = savedServer;
    if (savedPat === undefined) delete process.env.TFS_PAT;
    else process.env.TFS_PAT = savedPat;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  const response = await new TfsClient().rawRequest(url, 'GET');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, expected);
  assert.deepEqual(JSON.parse(response.body), payload);
});
