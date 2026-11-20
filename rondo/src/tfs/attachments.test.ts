import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentIdentity, normalizeAttachmentUrl } from './attachments.js';

const COLLECTION = 'http://tfs.example:8080/tfs/WN_Data_Platform';
const GUID = '015244e4-6152-40db-a6b9-e2e7794ac865';

test('查询串 GUID 与路径 GUID 归一到集合级下载端点，解码 HTML 实体和文件名', () => {
  const source = `${COLLECTION}/wrong-project/_apis/wit/attachments?FileNameGUID=${GUID.toUpperCase()}&amp;FileName=%E6%88%AA%E5%9B%BE%201.png`;
  const actual = new URL(normalizeAttachmentUrl(source, COLLECTION));
  assert.equal(actual.pathname, `/tfs/WN_Data_Platform/_apis/wit/attachments/${GUID}`);
  assert.equal(actual.searchParams.get('fileName'), '截图 1.png');
  assert.equal(actual.searchParams.get('download'), 'true');
  assert.equal(actual.searchParams.get('api-version'), '4.1');
  assert.equal(normalizeAttachmentUrl(`${COLLECTION}/_apis/wit/attachments/${GUID}?api-version=7.1`, COLLECTION),
    `${COLLECTION}/_apis/wit/attachments/${GUID}?download=true&api-version=4.1`);
});

test('附件身份忽略 project 路径、文件名和 API 版本，兼容既有正文映射', () => {
  const legacy = `${COLLECTION}/29dfa130-8e3b-40c3-bc8b-5eaa3f5be88d/_apis/wit/attachments?FileNameGUID=${GUID}&FileName=old.png`;
  const current = `${COLLECTION}/b2018645-8ea9-415f-b6ef-1722ef1f7be4/_apis/wit/attachments/${GUID.toUpperCase()}?fileName=new.png`;
  assert.equal(attachmentIdentity(legacy), attachmentIdentity(current));
  assert.equal(attachmentIdentity(legacy), attachmentIdentity(`${COLLECTION}/_apis/wit/attachments/${GUID}`));
  assert.notEqual(attachmentIdentity(legacy), attachmentIdentity(current.replace('WN_Data_Platform', 'Other')));
  assert.notEqual(attachmentIdentity(legacy), attachmentIdentity(current.replace('tfs.example', 'other.example')));
});

test('Azure DevOps 同组织附件身份稳定，非附件和未知范围 URL 保守处理', () => {
  const org = 'https://dev.azure.com/example';
  assert.equal(attachmentIdentity(`${org}/one/_apis/wit/attachments/${GUID}`),
    attachmentIdentity(`${org}/two/_apis/wit/attachments?filenameguid=${GUID}`));
  const external = 'https://images.example/image.png';
  assert.equal(attachmentIdentity(external), external);
  assert.equal(attachmentIdentity('not a url'), 'not a url');
  assert.notEqual(attachmentIdentity(`http://tfs/a/_apis/wit/attachments/${GUID}`),
    attachmentIdentity(`http://tfs/b/_apis/wit/attachments/${GUID}`));
});

test('规范下载仅接受可信同源同 collection 且有效 GUID 的附件', () => {
  const sources = [
    `https://outside.example/tfs/WN_Data_Platform/_apis/wit/attachments/${GUID}`,
    `${COLLECTION}-other/_apis/wit/attachments/${GUID}`,
    `${COLLECTION}/one/two/_apis/wit/attachments/${GUID}`,
    `${COLLECTION}/_apis/wit/attachments/not-a-guid`,
    `${COLLECTION}/_apis/wit/attachments?FileNameGUID=broken`,
    `${COLLECTION.replace('http://', 'http://name:secret@')}/_apis/wit/attachments/${GUID}`,
    `${COLLECTION}/_apis/wit/attachments/${GUID}?FileNameGUID=11111111-1111-1111-1111-111111111111`,
  ];
  for (const source of sources) assert.throws(() => normalizeAttachmentUrl(source, COLLECTION), /附件/);
});
