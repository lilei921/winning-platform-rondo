/** M10 前置能力实测：另一 Runtime 回读已删除目录的归档，并验证当前 CLI 安全停止；不伪造 Prepare/PR 事实。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const issue=process.argv[2];if(!issue)throw new Error('需要专用测试 Issue');
const base='D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist';
const {TfsClient}=await import(pathToFileURL(`${base}/tfs/client.js`).href);
const client=new TfsClient();
const multica='C:/Users/lilei/.multica/bin/multica.exe';
const workspace='60eb8cf4-31be-4a34-b744-8ef6a0bcf15d';
const fixture='D:/UserProgram/winning-platform-monorepo/.tmp/multica-08-local-mechanisms-20261113/M09';
const commit='df47bb6fd0fdc9b19ec6fe136818548b1403f847';
const report={timestamp:new Date().toISOString(),cwd:process.cwd(),task_id:process.env.MULTICA_TASK_ID,issue,commands:[],checks:[]};
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const check=(name,ok)=>report.checks.push({name,result:ok?'PASS':'FAIL'});
function getIssue(){const p=spawnSync(multica,['issue','get',issue,'--workspace-id',workspace,'--output','json'],{encoding:'utf8',timeout:30000,windowsHide:true});if(p.status)throw new Error('test Issue read failed');return JSON.parse(p.stdout);}
async function getWorkItem(){const r=await client.rawRequest(`${client.config.serverUrl}/_apis/wit/workitems/260986?$expand=relations&api-version=4.1`,'GET');if(r.statusCode!==200)throw new Error('test Work Item read failed');const b=JSON.parse(r.body);return {id:b.id,rev:b.rev,state:b.fields['System.State'],relations:(b.relations??[]).map(x=>({rel:x.rel,url:x.url}))};}
const before=getIssue();report.workitem_before=await getWorkItem();
check('no_project',before.project_id===null);check('no_local_git',!fs.existsSync('.git'));check('original_temporary_clone_absent',!fs.existsSync(`${fixture}/temporary-finalize`));
// 从既有私有 remote 直接读对象，不恢复原绝对路径；Git 仅执行只读 show。
for(const [file,expected] of Object.entries({'tasks.md':'4c936046f12f2edaab40ed38e3479bd851deaebb69f014125c8b1a834ed72ce2','evidence/fixture.json':'d2ae2c3a3748c56851aa0eaff3219eef4c784c4749af53c3cdf3faf2d2aa7e76'})){
  const p=spawnSync('C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/cmd/git.exe',['--git-dir',`${fixture}/remote.git`,'show',`${commit}:openspec/changes/archive/2026-11-13-validation-archive/${file}`],{windowsHide:true,timeout:30000});
  const hash=sha(p.stdout??Buffer.alloc(0));check(`read_archived_${file}`,p.status===0&&hash===expected);
  report.commands.push({kind:'git_show',file,commit,exit:p.status,sha256:hash});
}
const config=path.resolve('m10-runtime-config.json');fs.writeFileSync(config,JSON.stringify({runtime:{multica_cli:multica,workspace_id:workspace},registry:{}}));
for(const command of [['delivery','finalize','--phase','prepare'],['tfs','writeback'],['delivery','finalize','--phase','complete']]){
  const args=[`${base}/index.js`,...command,'--config',config,'--issue',issue];
  const p=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true,timeout:60000});
  let body;try{body=JSON.parse(p.stdout);}catch{body={result:'UNPARSEABLE'};}
  report.commands.push({kind:'rondo',argv:args,exit:p.status,response:body});
  check(`${command.join('_')}_requires_local_root`,p.status===3&&body.result==='UNKNOWN'&&body.reason?.includes('project_id'));
}
const after=getIssue();report.workitem_after=await getWorkItem();
report.metadata_before=before.metadata;report.metadata_after=after.metadata;
check('metadata_unchanged',JSON.stringify(before.metadata)===JSON.stringify(after.metadata));
check('issue_not_done',after.status!=='done');check('workitem_unchanged',JSON.stringify(report.workitem_before)===JSON.stringify(report.workitem_after));
report.prerequisite_probe=report.checks.every(x=>x.result==='PASS')?'PASS':'FAIL';
report.end_to_end='NOT_RUN: current Requirement commands stop at local Project root resolution before Prepare, Writeback or Complete';
report.interruption_recovery='NOT_RUN: remote artifact adaptation is not implemented; no prepared/pr/delivery facts fabricated';
fs.writeFileSync('M10-runtime-boundary-evidence.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
if(report.prerequisite_probe!=='PASS')process.exitCode=1;
