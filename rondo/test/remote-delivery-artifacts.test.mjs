import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteArtifactReader } from '../dist/commands/delivery/remote-artifacts.js';
import { authenticatedGitEnvironment as rootGitEnvironment } from '../dist/clients/authenticated-git.js';
import { canonicalRepositoryIdentity } from '../dist/commands/delivery/evidence-repository.js';

const repo='http://tfs.test/tfs/C/P/_git/root';
const approved='a'.repeat(40), ref='m10-fixture';
const live=`/openspec/changes/${ref}`;
test('Git 认证只限精确仓库 URL 的子进程环境，禁重定向且不改变父进程',()=>{
  const before={...process.env};const client={config:{serverUrl:'http://tfs.test/tfs/C',pat:'fixture-only-credential'}};
  const env=rootGitEnvironment(repo,client);const entries={};
  for(let i=Number(before.GIT_CONFIG_COUNT??0);i<Number(env.GIT_CONFIG_COUNT);i++)entries[env[`GIT_CONFIG_KEY_${i}`]]=env[`GIT_CONFIG_VALUE_${i}`];
  assert.equal(entries['credential.helper'],'');assert.equal(entries['http.followRedirects'],'false');
  assert.match(entries[`http.${repo}.extraHeader`],/^Authorization: Basic /);assert.deepEqual({...process.env},before);
  assert.throws(()=>rootGitEnvironment('http://evil/tfs/C/P/_git/root',client),/服务/);
});
function fixture(options={}) {
  const files={
    [approved]:{[`${live}/.openspec.yaml`]:'schema: corrective-change\n',[`${live}/proposal.md`]:'# fixture\n',[`${live}/tasks.md`]:'- [ ] 1.1 验证\n'},
  };
  const requests=[];
  const client={config:{serverUrl:'http://tfs.test/tfs/C'},async rawRequest(raw,method){
    const u=new URL(raw);requests.push({method,path:u.pathname,query:Object.fromEntries(u.searchParams)});
    const commit=u.searchParams.get('versionDescriptor.version');
    const scope=u.searchParams.get('scopePath');
    if(scope){const value=Object.keys(files[commit]??{}).filter(p=>p.startsWith(scope+'/')).map(path=>({path,commitId:commit,objectId:'c'.repeat(40),isFolder:false}));return {statusCode:200,body:JSON.stringify({value})};}
    const path=u.searchParams.get('path'),content=files[commit]?.[path];
    if(content===undefined)return {statusCode:404,body:'<html>missing</html>'};
    return {statusCode:200,body:JSON.stringify({path,commitId:commit,objectId:'c'.repeat(40),content,...options.response})};
  }};
  const reader=new RemoteArtifactReader(repo,client);
  return {reader,requests};
}

test('RemoteArtifactReader 按指定完整 Commit 读取工程契约', async () => {
  const f = fixture();
  const items = await f.reader.list(approved, live);
  assert.ok(items.length > 0);
  assert.ok(items.every(item => item.commitId === approved));
  assert.match(await f.reader.read(approved, live + '/tasks.md'), /\[ \]/);
  assert.ok(f.requests.every(x => x.query['versionDescriptor.version'] === approved));
});
test('跨服务 URL、响应错版本与不安全路径拒绝读取', async () => {
  assert.throws(() => new RemoteArtifactReader('http://elsewhere/tfs/C/P/_git/root', {config:{serverUrl:'http://tfs.test/tfs/C'}}), /服务/);
  const bad = fixture({response:{commitId:'d'.repeat(40)}});
  await assert.rejects(bad.reader.read(approved, live + '/tasks.md'), /commit/);
  const f = fixture();
  await assert.rejects(f.reader.read(approved, live + '/../outside.md'), /路径/);
  await assert.rejects(f.reader.list('abc', live), /commit/);
});

test('仓库身份比较保留 Collection、Project 和 Repository 全路径',()=>{
  const repo='http://tfs.test/tfs/C/Biz/_git/frame';
  assert.equal(canonicalRepositoryIdentity(repo),canonicalRepositoryIdentity('http://tfs.test/tfs/c/biz/_git/FRAME'));
  assert.notEqual(canonicalRepositoryIdentity(repo),canonicalRepositoryIdentity('http://tfs.test/tfs/Other/Biz/_git/frame'));
  assert.notEqual(canonicalRepositoryIdentity(repo),canonicalRepositoryIdentity('http://tfs.test/tfs/C/Other/_git/frame'));
});
