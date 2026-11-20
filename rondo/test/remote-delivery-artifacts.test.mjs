import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RemoteArtifactReader, materializeDeliveryArtifacts, rootGitEnvironment } from '../dist/commands/delivery/remote-artifacts.js';
import { resolveStableEvidenceCommit } from '../dist/commands/delivery/evidence-repository.js';
import { assertCurrentEvidence } from '../dist/commands/delivery/current-evidence.js';
import { computeContractFiles } from '../dist/commands/delivery/contract-files.js';

const repo='http://tfs.test/tfs/C/P/_git/root';
const approved='a'.repeat(40), latest='b'.repeat(40), ref='m10-fixture';
const live=`/openspec/changes/${ref}`, archived=`/openspec/changes/archive/2026-11-13-${ref}`;
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
    [latest]:{[`${archived}/.openspec.yaml`]:'schema: corrective-change\n',[`${archived}/proposal.md`]:'# fixture\n',[`${archived}/tasks.md`]:'- [x] 1.1 验证\n',[`${archived}/evidence.json`]:'{}'},
  };
  const requests=[];
  const client={config:{serverUrl:'http://tfs.test/tfs/C'},async rawRequest(raw,method){
    const u=new URL(raw);requests.push({method,path:u.pathname,query:Object.fromEntries(u.searchParams)});
    if(u.pathname.endsWith('/refs'))return {statusCode:200,body:JSON.stringify({value:[{name:'refs/heads/validation',objectId:latest}]})};
    const commit=u.searchParams.get('versionDescriptor.version');
    const scope=u.searchParams.get('scopePath');
    if(scope){const value=Object.keys(files[commit]??{}).filter(p=>p.startsWith(scope+'/')).map(path=>({path,commitId:commit,objectId:'c'.repeat(40),isFolder:false}));return {statusCode:200,body:JSON.stringify({value})};}
    const path=u.searchParams.get('path'),content=files[commit]?.[path];
    if(content===undefined)return {statusCode:404,body:'<html>missing</html>'};
    return {statusCode:200,body:JSON.stringify({path,commitId:commit,objectId:'c'.repeat(40),content,...options.response})};
  }};
  const reader=new RemoteArtifactReader(repo,client);
  const source={repo_url:repo,branch:'approval-audit-only',commit:approved,change_ref:ref};
  return {reader,files,requests,source,md:{'analysis.change_ref':ref,'analysis.source':JSON.stringify(source)}};
}

test('远端归档固定最新 SHA 读取，批准契约允许 checkbox 进度，缓存无 Git 仓',async()=>{
  const f=fixture();const snapshot=await materializeDeliveryArtifacts(f.reader,f.md,'validation');
  try {
    assert.equal(snapshot.commit,latest);assert.equal(snapshot.archived,true);
    assert.equal(existsSync(join(snapshot.paths.rootRepo,'.git')),false);
    assert.match(readFileSync(join(snapshot.changeDir,'tasks.md'),'utf8'),/\[x\]/);
    assert.equal(f.requests.filter(x=>x.path.endsWith('/refs')).length,1);
    assert.ok(f.requests.filter(x=>x.path.endsWith('/items')).every(x=>[approved,latest].includes(x.query['versionDescriptor.version'])));
  } finally {snapshot.dispose();}
  assert.equal(existsSync(snapshot.paths.rootRepo),false);
});

test('归档正文/文件集合偏离批准基线即关闭，不能跟随已更新 Evidence 放行',async()=>{
  for(const mutate of [f=>f.files[latest][`${archived}/proposal.md`]='changed',f=>f.files[latest][`${archived}/specs/new/spec.md`]='added']){
    const f=fixture();mutate(f);await assert.rejects(materializeDeliveryArtifacts(f.reader,f.md,'validation'),/批准|契约/);
  }
});

test('当前/归档或多个归档身份冲突即拒绝',async()=>{
  for(const target of [live,`/openspec/changes/archive/2026-11-12-${ref}`]){
    const f=fixture();f.files[latest][`${target}/tasks.md`]='- [x] 1.1 验证';
    await assert.rejects(materializeDeliveryArtifacts(f.reader,f.md,'validation'),/唯一|冲突/);
  }
});

test('跨服务 URL、响应错版本与不安全相对路径不能物化或泄露凭据',async()=>{
  const f=fixture();assert.throws(()=>new RemoteArtifactReader('http://elsewhere/tfs/C/P/_git/root',{config:{serverUrl:'http://tfs.test/tfs/C'}}),/服务/);
  const bad=fixture({response:{commitId:'d'.repeat(40)}});await assert.rejects(materializeDeliveryArtifacts(bad.reader,bad.md,'validation'),/commit|版本/);
  f.files[latest][`${archived}/../outside.md`]='bad';await assert.rejects(materializeDeliveryArtifacts(f.reader,f.md,'validation'),/路径/);
  await assert.rejects(f.reader.pin(''),/分支/);
});

test('稳定 Evidence 身份使用配置 repo_url 和完整 SHA，不读旧机器路径',()=>{
  const registry={frame:{repo_path:'frame',repo_url:'http://tfs.test/tfs/C/Biz/_git/frame',tfs_repo:'frame',tfs_project:'Biz'}};
  const commit={repo_key:'frame',repo_url:registry.frame.repo_url,sha:'d'.repeat(40),repo_path:'Z:/deleted/old/worktree'};
  assert.equal(resolveStableEvidenceCommit(registry,commit).key,'frame');
  assert.equal(resolveStableEvidenceCommit(registry,commit,'http://tfs.test/tfs/C').project,'Biz');
  for(const server of ['http://elsewhere/tfs/C','http://tfs.test/tfs/Other'])assert.throws(()=>resolveStableEvidenceCommit(registry,commit,server),/Collection/);
  for(const changed of [{sha:'abcdef0'},{repo_url:'http://evil/tfs/C/Biz/_git/frame'},{repo_key:'unknown'}, {repo_url:repo}])assert.throws(()=>resolveStableEvidenceCommit(registry,{...commit,...changed}));
});

test('远端 Completion Evidence 拒绝旧路径或错仓候选，旧本地模式继续兼容',()=>{
  const dir=mkdtempSync(join(tmpdir(),'remote-evidence-'));
  try{
    writeFileSync(join(dir,'proposal.md'),'# fixture\n');writeFileSync(join(dir,'tasks.md'),'- [x] 1.1 验证\n');
    const registry={frame:{repo_path:'frame',repo_url:'http://tfs.test/tfs/C/Biz/_git/frame',tfs_repo:'frame',tfs_project:'Biz'}};
    const md={'dev.dispatch':JSON.stringify([{active:true,change_ref:ref,task_refs:['1.1']}]),pr_prep:JSON.stringify([{repo_key:'frame',candidate_commit:'d'.repeat(40)}])};
    const write=commit=>writeFileSync(join(dir,'evidence.json'),JSON.stringify({change_ref:ref,task_refs:['1.1'],commits:[commit],contract_files:computeContractFiles(dir)}));
    write({repo_key:'frame',repo_url:registry.frame.repo_url,sha:'d'.repeat(40),repo_path:'Z:/deleted'});
    assert.doesNotThrow(()=>assertCurrentEvidence(registry,md,dir,ref,dir,'TEST-12',true));
    write({repo_path:join(dir,'frame'),sha:'d'.repeat(40)});
    assert.throws(()=>assertCurrentEvidence(registry,md,dir,ref,dir,'TEST-12',true),/无匹配 Evidence/);
    assert.doesNotThrow(()=>assertCurrentEvidence(registry,md,dir,ref,dir,'TEST-12'));
    write({repo_key:'frame',repo_url:repo,sha:'d'.repeat(40)});
    assert.throws(()=>assertCurrentEvidence(registry,md,dir,ref,dir,'TEST-12',true),/无匹配 Evidence/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
