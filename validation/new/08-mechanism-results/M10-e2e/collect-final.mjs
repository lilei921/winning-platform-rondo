/** 仅在真实双 Runtime 完成后汇总回读与逐字节证据；不补写交付事实。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TfsClient} from '../../../../../../tools/rondo/dist/tfs/client.js';
import {RemoteArtifactReader,materializeDeliveryArtifacts} from '../../../../../../tools/rondo/dist/commands/delivery/remote-artifacts.js';
const dir=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(dir,'../../../../../..');
const setup=JSON.parse(fs.readFileSync(path.join(dir,'runtime-setup.json'),'utf8'));
const fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixture-state.json'),'utf8'));
const cli='C:/Users/lilei/.multica/bin/multica.exe',ws='60eb8cf4-31be-4a34-b744-8ef6a0bcf15d';
const client=new TfsClient();
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const save=(n,data)=>fs.writeFileSync(path.join(dir,n),JSON.stringify(data,null,2)+'\n');
function call(args){const p=spawnSync(cli,[...args,'--workspace-id',ws,'--output','json'],{encoding:'utf8',windowsHide:true,timeout:60000});if(p.status!==0)throw new Error(p.stderr||p.stdout);return JSON.parse(p.stdout);}
const final={at:new Date().toISOString(),scope:'M10 real Runtime E2E; isolated test Work Item 260986',copies:[],runs:{},checks:[]};
function check(name,ok){final.checks.push({name,result:ok?'PASS':'FAIL'});if(!ok)throw new Error(name);}
for(const mode of ['prepare','finish']){
 const runs=call(['issue','runs',setup[mode].id]);save(`${mode}-runs.json`,runs);final.runs[mode]=runs.map(r=>({id:r.id,status:r.status,runtime_id:r.runtime_id,work_dir:r.work_dir??r.result?.work_dir}));
 const success=runs.find(r=>r.status==='completed'&&(r.work_dir??r.result?.work_dir));if(!success)throw new Error(`${mode} Runtime 尚未完成`);
 const cwd=success.work_dir??success.result.work_dir;
 for(const file of fs.readdirSync(cwd).filter(n=>/^(?:M10-.*\.(?:json|jsonl)|(?:prepare|writeback|complete)-.*\.(?:json|log))$/.test(n))){
  const src=path.join(cwd,file),dest=path.join(dir,`${mode}-${file}`);fs.copyFileSync(src,dest);const h=hash(src);check(`copy_${mode}_${file}`,h===hash(dest));final.copies.push({source:src,file:path.basename(dest),sha256:h});
 }
 const report=JSON.parse(fs.readFileSync(path.join(cwd,`M10-${mode}-runtime-evidence.json`),'utf8'));check(`${mode}_all_assertions`,report.overall==='PASS'&&report.checks.every(c=>c.result==='PASS'));final[mode]={task:report.task_id,cwd,assertions:report.checks.length};
}
check('different_runtime',final.runs.prepare[0].runtime_id!==final.runs.finish[0].runtime_id);check('different_task_directory',final.prepare.cwd!==final.finish.cwd);
const issue=call(['issue','get',setup.delivery.id]);save('delivery-final.json',issue);check('delivery_done',issue.status==='done');check('pending_cleared',!issue.metadata['finalize.pending']);
async function get(url){const r=await client.rawRequest(url,'GET');if(r.statusCode!==200)throw new Error(`GET ${r.statusCode}`);return JSON.parse(r.body);}
const parent=await get(`${client.config.serverUrl}/_apis/wit/workitems/260986?$expand=relations&api-version=4.1`);save('tfs-parent-final.json',parent);
const childRefs=(parent.relations??[]).filter(r=>r.rel==='System.LinkTypes.Hierarchy-Forward');check('one_real_child',childRefs.length===1);
const childId=Number(childRefs[0].url.split('/').pop());const child=await get(`${client.config.serverUrl}/_apis/wit/workitems/${childId}?$expand=relations&api-version=4.1`);save('tfs-child-final.json',child);final.tfs={parent:260986,parent_rev:parent.rev,child:childId,child_rev:child.rev};
check('tfs_parent_child_resolved',parent.fields['System.State']==='已解决'&&child.fields['System.State']==='已解决'&&child.fields['Microsoft.VSTS.Scheduling.RemainingWork']===0);
const updates=await get(`${client.config.serverUrl}/_apis/wit/workitems/260986/updates?api-version=4.1`);save('tfs-parent-updates.json',updates);const comments=updates.value.filter(u=>u.fields?.['System.History']?.newValue?.includes(`Multica ${issue.identifier}`));check('one_parent_writeback_comment',comments.length===1);
const snapshot=await materializeDeliveryArtifacts(new RemoteArtifactReader(fixture.root_url),issue.metadata,fixture.branch.root);
try{check('archive_confirmed_after_runtime_cleanup',snapshot.archived);final.archive={commit:snapshot.commit,branch:snapshot.branch,files:fs.readdirSync(snapshot.changeDir).filter(f=>fs.statSync(path.join(snapshot.changeDir,f)).isFile()).map(f=>({file:f,sha256:hash(path.join(snapshot.changeDir,f))}))};}finally{snapshot.dispose();}
const secretForms=[client.config.pat,Buffer.from(`:${client.config.pat}`).toString('base64')];
const artifacts=fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()&&!['final-evidence-manifest.json'].includes(f));
for(const f of artifacts){const body=fs.readFileSync(path.join(dir,f),'utf8');if(secretForms.some(s=>body.includes(s)))throw new Error(`凭据扫描命中（不显示内容）：${f}`);}
final.secret_scan={actual_tfs_credential_matches:0,files:artifacts.length};
final.artifacts=artifacts.map(f=>({file:f,sha256:hash(path.join(dir,f))}));
const files=['src/clients/config.ts','src/clients/runtime-paths.ts','src/clients/spawn.ts','src/commands/delivery/current-evidence.ts','src/commands/delivery/evidence-repository.ts','src/commands/delivery/remote-artifacts.ts','src/commands/delivery/finalize.ts','src/commands/tfs/writeback.ts','test/remote-delivery-artifacts.test.mjs'];
final.build={package_version:'1.2.20 + unreleased workspace M10 adaptation',files:files.map(f=>({file:`tools/rondo/${f}`,sha256:hash(path.join(root,'tools/rondo',f))}))};
final.overall='PASS';save('final-evidence-manifest.json',final);console.log(JSON.stringify({overall:final.overall,prepare:final.prepare,finish:final.finish,tfs:final.tfs,archive:final.archive,secret_scan:final.secret_scan},null,2));
