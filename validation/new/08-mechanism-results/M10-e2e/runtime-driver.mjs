/** 必须在真实 Multica Task 内运行；Prepare 与 Writeback/Complete 使用不同 Runtime。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
const [mode,issueKey]=process.argv.slice(2);
if(!process.env.MULTICA_TASK_ID||!['prepare','finish'].includes(mode)||!issueKey)throw new Error('必须在真实 Task 指定 prepare/finish 和测试 Delivery Issue');
const base=path.dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(fs.readFileSync(path.join(base,'fixture-state.json'),'utf8'));
const dist='D:/UserProgram/winning-platform-monorepo/tools/rondo/dist';
const {TfsClient}=await import(pathToFileURL(`${dist}/tfs/client.js`).href);
const {RemoteArtifactReader}=await import(pathToFileURL(`${dist}/commands/delivery/remote-artifacts.js`).href);
const tfs=new TfsClient();
const cli='C:/Users/lilei/.multica/bin/multica.exe';
const ws='60eb8cf4-31be-4a34-b744-8ef6a0bcf15d';
const config=path.resolve('M10-runtime-registry.json');
fs.writeFileSync(config,JSON.stringify({runtime:{multica_cli:cli,workspace_id:ws,root_branch:fixture.branch.root},registry:fixture.registry},null,2));
const report={started_at:new Date().toISOString(),mode,issue:issueKey,task_id:process.env.MULTICA_TASK_ID,cwd:process.cwd(),checks:[],commands:[],snapshots:[]};
const evidencePath=path.resolve(`M10-${mode}-runtime-evidence.json`);
const save=()=>fs.writeFileSync(evidencePath,JSON.stringify(report,null,2)+'\n');
function check(name,ok){report.checks.push({name,result:ok?'PASS':'FAIL'});save();if(!ok)throw new Error(`M10 check failed: ${name}`);}
function getIssue(){const p=spawnSync(cli,['issue','get',issueKey,'--workspace-id',ws,'--output','json'],{encoding:'utf8',timeout:30000,windowsHide:true});if(p.status!==0)throw new Error('测试 Issue 读取失败');return JSON.parse(p.stdout);}
async function getWi(id){const r=await tfs.rawRequest(`${tfs.config.serverUrl}/_apis/wit/workitems/${id}?$expand=relations&api-version=4.1`,'GET');if(r.statusCode!==200)throw new Error(`Work Item ${id} GET ${r.statusCode}`);const b=JSON.parse(r.body);return{id:b.id,rev:b.rev,state:b.fields['System.State'],title:b.fields['System.Title'],remaining:b.fields['Microsoft.VSTS.Scheduling.RemainingWork'],completed:b.fields['Microsoft.VSTS.Scheduling.CompletedWork'],estimate:b.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'],relations:b.relations??[]};}
async function snapshot(label){
 const issue=getIssue();const pending=issue.metadata?.['finalize.pending']?JSON.parse(issue.metadata['finalize.pending']):null;
 const dispatch=JSON.parse(issue.metadata?.['dev.dispatch']??'[]');
 const ids=[...new Set(dispatch.flatMap(d=>Object.values(d.tfs_task_ids??{})))];
 const reader=new RemoteArtifactReader(fixture.root_url);
 const commit=await reader.pin(fixture.branch.root);
 const items=await reader.list(commit,'/openspec/changes');
 const archived=items.filter(x=>!x.isFolder&&x.path.includes(`-${fixture.change}/`)).map(x=>x.path);
 const comments=spawnSync(cli,['issue','comment','list',issueKey,'--full','--workspace-id',ws,'--output','json'],{encoding:'utf8',timeout:30000,windowsHide:true});if(comments.status!==0)throw new Error('评论回读失败');
 const list=JSON.parse(comments.stdout);
 const value={label,at:new Date().toISOString(),issue_id:issue.id,status:issue.status,metadata:issue.metadata,pending,root_commit:commit,archived_files:archived,task_ids:ids,workitem:await getWi(260986),children:await Promise.all(ids.map(getWi)),summary_comments:list.filter(c=>c.content?.includes('交付完成摘要（finalize-delivery）')).map(c=>({id:c.id,sha256:crypto.createHash('sha256').update(c.content).digest('hex')})),temporary_roots:fs.readdirSync('.').filter(n=>n.startsWith('.rondo-finalize-')||n.startsWith('.rondo-artifacts-'))};
 report.snapshots.push(value);save();return value;
}
function run(label,args,fault){
 const env={...process.env};const key=Object.keys(env).find(k=>k.toLowerCase()==='path');const inherited=env[key]??'';for(const k of Object.keys(env))if(k.toLowerCase()==='path')delete env[k];
 env.PATH=`C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/cmd;C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/mingw64/bin;${inherited}`;
 env.GIT_TERMINAL_PROMPT='0';env.M10_DELIVERY_ID=getIssue().id;
 const proxyKey=Object.keys(env).find(k=>k.toLowerCase()==='no_proxy');const noProxy=env[proxyKey]??'';
 if(proxyKey)delete env[proxyKey];env.NO_PROXY=[noProxy,new URL(fixture.root_url).hostname].filter(Boolean).join(',');
 if(fault)env.M10_FAULT=fault;else delete env.M10_FAULT;
 const argv=[...(fault?['--import',pathToFileURL(path.join(base,'inject-failure.mjs')).href]:[]),`${dist}/index.js`,...args,'--config',config,'--issue',issueKey];
 const started=new Date().toISOString();const p=spawnSync(process.execPath,argv,{encoding:'utf8',env,windowsHide:true,timeout:1500000,maxBuffer:32*1024*1024});
 fs.writeFileSync(`${label}.stdout.json`,p.stdout??'');fs.writeFileSync(`${label}.stderr.log`,p.stderr??'');
 let response;try{response=JSON.parse(p.stdout);}catch{response={result:'UNPARSEABLE'};}
 const item={label,started_at:started,finished_at:new Date().toISOString(),argv,fault:fault??null,exit:p.status,error:p.error?.code,response};report.commands.push(item);save();return item;
}
try{
 const start=await snapshot('before');
 check('only_authorized_workitem',start.metadata['tfs.id']==='260986');check('no_local_git_checkout',!fs.existsSync('.git'));check('no_original_engineer_path',!fs.existsSync('Z:/intentionally-deleted-engineer/frame'));
 if(mode==='prepare'){
  const failed=run('prepare-push-before-metadata',['delivery','finalize','--phase','prepare'],'after_archive_push');
  check('injected_after_real_archive_push',failed.exit===3&&failed.response.reason?.includes('M10_INJECTED_after_archive_push'));
  const partial=await snapshot('archive_published_metadata_failed');
  check('archive_is_remote_without_prepared_marker',partial.archived_files.length>=4&&!partial.pending?.prepared_change_ref);
  check('published_temporary_root_deleted',partial.temporary_roots.length===0);
  check('prepare_did_not_write_tfs',partial.workitem.rev===start.workitem.rev&&partial.task_ids.length===0);
  const recovered=run('prepare-recovered',['delivery','finalize','--phase','prepare']);check('prepare_recovered_pass',recovered.exit===0&&recovered.response.status==='prepared');
  const ready=await snapshot('prepared');check('prepare_recovery_did_not_republish',ready.root_commit===partial.root_commit);check('prepared_marker_confirmed',ready.pending?.prepared_change_ref===fixture.change);check('no_remaining_temp_roots',ready.temporary_roots.length===0);
 }else{
  check('prepare_from_previous_runtime',start.pending?.prepared_change_ref===fixture.change&&start.archived_files.length>=4);
  const failed=run('writeback-interrupted',['tfs','writeback'],'during_writeback');check('writeback_interruption_observed',failed.exit===3&&failed.response.reason?.includes('M10_INJECTED_during_writeback'));
  const partial=await snapshot('task_materialized_before_state');check('one_real_child_preserved',partial.task_ids.length===1&&partial.children[0].state!=='已解决');
  check('not_done_before_writeback',partial.status!=='done'&&partial.metadata['delivery.tfs_written']!=='true');
  const recovered=run('writeback-recovered',['tfs','writeback']);check('writeback_recovered_pass',recovered.exit===0&&recovered.response.result==='PASS');
  check('stable_commit_link_succeeded',recovered.response.commit_links?.commit_link_failed?.length===0);
  const written=await snapshot('tfs_written');check('child_reused_without_duplicate',JSON.stringify(written.task_ids)===JSON.stringify(partial.task_ids));
  check('real_parent_and_child_resolved',written.workitem.state==='已解决'&&written.children[0].state==='已解决'&&written.children[0].remaining===0);
  const links=written.children[0].relations.filter(r=>r.rel==='ArtifactLink'&&typeof r.url==='string'&&decodeURIComponent(r.url).toLowerCase().endsWith(`/b52a4fd8-ec61-4cb5-b2f3-c3b61e41da74/${fixture.candidate}`));check('exact_candidate_linked_once',links.length===1);
  const duplicate=run('writeback-idempotent',['tfs','writeback']);check('writeback_replay_pass',duplicate.exit===0);
  const replay=await snapshot('writeback_replayed');check('tfs_revisions_unchanged_on_replay',replay.workitem.rev===written.workitem.rev&&replay.children[0].rev===written.children[0].rev);
  const completeFailed=run('complete-interrupted',['delivery','finalize','--phase','complete'],'during_complete');check('complete_interruption_observed',completeFailed.exit===3&&completeFailed.response.reason?.includes('M10_INJECTED_during_complete'));
  const beforeDone=await snapshot('summary_before_done');check('summary_persisted_pending_retained',beforeDone.summary_comments.length===1&&Boolean(beforeDone.metadata['delivery.summary_comment_id'])&&beforeDone.status!=='done'&&Boolean(beforeDone.pending));
  const completed=run('complete-recovered',['delivery','finalize','--phase','complete']);check('complete_recovered_pass',completed.exit===0&&completed.response.status==='done');
  const done=await snapshot('done');check('done_and_pending_cleared',done.status==='done'&&!done.pending);check('summary_not_duplicated',done.summary_comments.length===1&&done.summary_comments[0].id===beforeDone.summary_comments[0].id);check('root_not_republished',done.root_commit===start.root_commit);
  const again=run('complete-idempotent',['delivery','finalize','--phase','complete']);check('done_replay_noop',again.exit===0&&again.response.already==='done');
  const final=await snapshot('final');check('no_tfs_rewrite_on_complete',final.workitem.rev===written.workitem.rev&&final.children[0].rev===written.children[0].rev);check('all_artifact_caches_deleted',final.temporary_roots.length===0);
 }
 report.overall='PASS';
}catch(e){report.overall='FAIL';report.error=e.message;process.exitCode=1;}
report.finished_at=new Date().toISOString();save();console.log(JSON.stringify({overall:report.overall,error:report.error,evidence:evidencePath,checks:report.checks},null,2));
