/** 260986 专用 TFS 隔离 fixture。只写明确列出的测试分支；每步成功即保存可恢复账本。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const out=path.dirname(fileURLToPath(import.meta.url));
const codeRoot='D:/UserProgram/winning-platform-monorepo/tools/rondo';
const {TfsClient}=await import(pathToFileURL(`${codeRoot}/dist/tfs/client.js`).href);
const {normalizeContractText}=await import(pathToFileURL(`${codeRoot}/dist/commands/delivery/contract-files.js`).href);
const client=new TfsClient();
const rootUrl='http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_git/winning-platform-monorepo';
const bizUrl='http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/WiNEX%20DataFactory/_git/winning-dps-df-frame';
const branch={root:'codex/m10-260986-20261113-root',target:'codex/m10-260986-20261113-target',source:'codex/m10-260986-20261113-source'};
const change='m10-260986-runtime-recovery';
const ledgerPath=path.join(out,'fixture-state.json');
const state=fs.existsSync(ledgerPath)?JSON.parse(fs.readFileSync(ledgerPath,'utf8')):{created_at:new Date().toISOString(),root_url:rootUrl,business_url:bizUrl,branch,change,requests:[]};
const save=()=>fs.writeFileSync(ledgerPath,JSON.stringify(state,null,2)+'\n');
const api=repo=>repo.replace('/_git/','/_apis/git/repositories/');
async function call(url,method='GET',body){
 const response=await client.rawRequest(url,method,body===undefined?undefined:JSON.stringify(body),body===undefined?undefined:{'Content-Type':'application/json'});
 state.requests.push({timestamp:new Date().toISOString(),method,url,status:response.statusCode});save();
 let parsed;try{parsed=JSON.parse(response.body);}catch{throw new Error(`TFS ${method} HTTP ${response.statusCode}: non-JSON`);}
 if(response.statusCode<200||response.statusCode>=300)throw new Error(`TFS ${method} HTTP ${response.statusCode}: ${String(parsed.message??'request failed').slice(0,400)}`);
 if(method==='PATCH'&&url.includes('/pullrequests/')){state.pr_patch_response=parsed;save();}
 return parsed;
}
const url=(base,resource,params={})=>{const u=new URL(`${api(base)}/${resource}`);Object.entries({...params,'api-version':'4.1'}).forEach(([k,v])=>u.searchParams.set(k,v));return u.href;};
async function ref(repo,name){const r=await call(url(repo,'refs',{filter:`heads/${name}`}));return r.value?.find(x=>x.name===`refs/heads/${name}`)?.objectId??null;}
async function createRef(repo,name,sha){
 if(!Object.values(branch).includes(name))throw new Error('测试分支不在白名单');
 const current=await ref(repo,name);if(current)throw new Error(`测试分支已存在而无账本记录: ${name}`);
 const r=await call(url(repo,'refs'),'POST',[{name:`refs/heads/${name}`,oldObjectId:'0'.repeat(40),newObjectId:sha}]);
 if(!r.value?.[0]?.success)throw new Error('创建测试 ref 未确认成功');
}
async function push(repo,name,old,files,comment){
 if(!Object.values(branch).includes(name))throw new Error('测试分支不在白名单');
 if(await ref(repo,name)!==old)throw new Error('测试分支前进，停止自动覆盖');
 const changes=Object.entries(files).map(([p,v])=>({changeType:v.type,item:{path:p},newContent:{content:v.content,contentType:'rawtext'}}));
 const r=await call(url(repo,'pushes'),'POST',{refUpdates:[{name:`refs/heads/${name}`,oldObjectId:old}],commits:[{comment,changes}]});
 const head=r.commits?.[0]?.commitId;if(!/^[0-9a-f]{40}$/.test(head??'')||await ref(repo,name)!==head)throw new Error('测试 push 未回读确认');return head;
}
async function readFile(repo,commit,p){return call(url(repo,'items',{path:p,includeContent:'true','versionDescriptor.versionType':'commit','versionDescriptor.version':commit}));}
if(!state.baseline){
 const wi=await call(`${client.config.serverUrl}/_apis/wit/workitems/260986?$expand=relations&api-version=4.1`);
 state.baseline={root:await ref(rootUrl,'rondo'),business:await ref(bizUrl,'dev'),workitem:{id:wi.id,rev:wi.rev,state:wi.fields['System.State'],title:wi.fields['System.Title'],relations:wi.relations??[]}};
 if(wi.id!==260986||wi.fields['System.WorkItemType']!=='需求')throw new Error('用户测试工作项身份不符');save();
}
if(process.argv[2]==='inspect'){console.log(JSON.stringify(state.baseline,null,2));process.exit(0);}
if(!['seed','publish','observe'].includes(process.argv[2]))throw new Error('仅支持 inspect / seed / publish / observe');
for(const [key,repo,base] of [['root',rootUrl,state.baseline.root],['target',bizUrl,state.baseline.business],['source',bizUrl,state.baseline.business]]){
 if(!state[`created_${key}`]){await createRef(repo,branch[key],base);state[`created_${key}`]=true;save();}
}
const markerPath='/multica-validation/m10-260986-20261113.txt';
const marker='M10 isolated delivery fixture; authorized test work item 260986; 2026-11-13.\n';
if(!state.candidate){state.candidate=await push(bizUrl,branch.source,state.baseline.business,{[markerPath]:{type:'add',content:marker}},'AI-CHECK test: M10 260986 isolated delivery candidate');save();}
const candidateFile=await readFile(bizUrl,state.candidate,markerPath);
if(candidateFile.commitId!==state.candidate||candidateFile.content!==marker)throw new Error('候选标记不匹配');
state.candidate_validation={result:'PASS',path:markerPath,commit:state.candidate,object_id:candidateFile.objectId,sha256:crypto.createHash('sha256').update(marker).digest('hex')};save();
if(!state.pr){
 const r=await call(url(bizUrl,'pullrequests'),'POST',{sourceRefName:`refs/heads/${branch.source}`,targetRefName:`refs/heads/${branch.target}`,title:'[M10 TEST 260986] 跨 Runtime 收口与恢复验证',description:'用户授权的隔离机制验证。仅在测试分支合并一个测试标记文件；不代表生产需求交付。'});
 state.pr={id:r.pullRequestId,url:`${bizUrl}/pullrequest/${r.pullRequestId}`,source:branch.source,target:branch.target};save();
}
let pr=await call(url(bizUrl,`pullrequests/${state.pr.id}`));
state.pr_latest={at:new Date().toISOString(),status:pr.status,mergeStatus:pr.mergeStatus,mergeFailureMessage:pr.mergeFailureMessage,mergeFailureType:pr.mergeFailureType};save();
if(process.argv[2]==='observe'){console.log(JSON.stringify(state.pr_latest,null,2));process.exit(0);}
if(pr.sourceRefName!==`refs/heads/${branch.source}`||pr.targetRefName!==`refs/heads/${branch.target}`)throw new Error('测试 PR 身份不符');
if(pr.status!=='completed'&&process.argv[2]==='seed'){
 await call(url(bizUrl,`pullrequests/${state.pr.id}`),'PATCH',{status:'completed',lastMergeSourceCommit:{commitId:state.candidate},completionOptions:{deleteSourceBranch:false,squashMerge:false,mergeCommitMessage:'AI-CHECK test: merge M10 isolated candidate'}});
 for(let i=0;i<20;i++){pr=await call(url(bizUrl,`pullrequests/${state.pr.id}`));if(pr.status==='completed')break;await new Promise(r=>setTimeout(r,1000));}
}
if(process.argv[2]==='seed'&&(pr.status!=='completed'||pr.lastMergeSourceCommit?.commitId!==state.candidate))throw new Error('测试 PR 尚未精确合并候选');
state.pr={...state.pr,status:pr.status,source_commit:pr.lastMergeSourceCommit?.commitId,merge_commit:pr.lastMergeCommit?.commitId};save();
const prefix=`/openspec/changes/${change}`;
const proposal=`# M10 隔离交付验证\n\n## Problem\n跨 Runtime 收口应在原临时目录删除后仍能读取已发布工件。现有路径依赖导致 UNKNOWN；依据 08 方案 M10。\n\n## Reproduction / Failure Path\n无 Project Runtime 调用 Prepare/Writeback/Complete，旧版因缺 project_id 停止。\n\n## Root Cause\nconfirmed：旧实现依赖本地根仓和旧 repo_path。\n\n## Fix Strategy\n本 fixture 发布一个隔离业务候选标记，供真实 Rondo 远端工件适配验证收口与恢复。\n\n## Scope\nFix Scope：仅测试分支的 multica-validation 标记。Regression Scope：固定 SHA、归档、TFS 子任务和三个中断恢复点。\n\n## Impact\n测试工作项 260986 允许状态、子任务与关联写入；测试分支独立，验收不代表生产切换。\n\n## Specification Relation\n不改变业务产品行为，skip_specs=true，无 Delta Spec。\n`;
const tasks='# Tasks\n\n- [ ] 1.1 发布并验证隔离业务候选标记，核对精确合并源 Commit\n';
const schema='schema: corrective-change\nskip_specs: true\n';
if(!state.approved_commit){state.approved_commit=await push(rootUrl,branch.root,state.baseline.root,{[`${prefix}/proposal.md`]:{type:'add',content:proposal},[`${prefix}/tasks.md`]:{type:'add',content:tasks},[`${prefix}/.openspec.yaml`]:{type:'add',content:schema}},'AI-CHECK test: publish M10 test approval baseline');save();}
const contract={algorithm:'sha256',files:Object.fromEntries(Object.entries({'proposal.md':proposal,'tasks.md':tasks}).map(([p,c])=>[p,crypto.createHash('sha256').update(normalizeContractText(p,c)).digest('hex')]))};
const evidence={change_ref:change,task_refs:['1.1'],local_validation:{result:'PASS',summary:'TFS fixed candidate marker GET content/Commit matches fixture',details:state.candidate_validation},code_review:{result:'PASS',summary:'测试候选仅新增授权标记文件，正文与白名单固定内容一致',findings:[]},commits:[{repo_key:'frame',repo_url:bizUrl,sha:state.candidate,repo_path:'Z:/intentionally-deleted-engineer/frame'}],contract_files:contract};
if(!state.published_commit){state.published_commit=await push(rootUrl,branch.root,state.approved_commit,{[`${prefix}/tasks.md`]:{type:'edit',content:tasks.replace('[ ]','[x]')},[`${prefix}/evidence.json`]:{type:'add',content:JSON.stringify(evidence,null,2)+'\n'}},'AI-CHECK test: publish M10 validated progress and stable evidence');save();}
state.analysis_source={repo_url:rootUrl,branch:branch.root,commit:state.approved_commit,change_ref:change};
state.registry={frame:{repo_path:'winning-dps-df-frame',repo_url:bizUrl,tfs_repo:'winning-dps-df-frame',tfs_project:'WiNEX DataFactory'}};
save();console.log(JSON.stringify({branch,change,candidate:state.candidate,pr:state.pr,approved_commit:state.approved_commit,published_commit:state.published_commit},null,2));
