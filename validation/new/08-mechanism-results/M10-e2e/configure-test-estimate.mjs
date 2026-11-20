/** 本次专用子任务的外部管理前置；1h 仅为机制测试值，不是生产实际工时。 */
import fs from 'node:fs';
import {TfsClient} from '../../../../../../tools/rondo/dist/tfs/client.js';
import {MulticaClient} from '../../../../../../tools/rondo/dist/clients/multica.js';
if(!process.env.MULTICA_TASK_ID)throw new Error('必须在真实 Runtime 执行');
const c=new TfsClient();const mc=new MulticaClient({multica_cli:'C:/Users/lilei/.multica/bin/multica.exe',workspace_id:'60eb8cf4-31be-4a34-b744-8ef6a0bcf15d'});
const issue=mc.getIssue('TEST-13');const ids=JSON.parse(issue.metadata['dev.dispatch']).flatMap(d=>Object.values(d.tfs_task_ids??{}));
if(issue.metadata['tfs.id']!=='260986'||ids.length!==1||ids[0]!==264845)throw new Error('不是本轮专用测试任务');
const url=`${c.config.serverUrl}/_apis/wit/workitems/264845?api-version=4.1`;
async function get(){const r=await c.rawRequest(`${url}&$expand=relations`,'GET');if(r.statusCode!==200)throw new Error(`GET ${r.statusCode}`);return JSON.parse(r.body);}
const before=await get();
if(!before.fields['System.Title']?.startsWith('[TEST-13 1.1]')||!before.relations?.some(r=>r.rel==='System.LinkTypes.Hierarchy-Reverse'&&r.url.endsWith('/260986')))throw new Error('标题/父项身份不匹配');
const oe='Microsoft.VSTS.Scheduling.OriginalEstimate';const rw='Microsoft.VSTS.Scheduling.RemainingWork';
let patched=false;
if(before.fields[oe]===undefined||before.fields[oe]===null){
 const doc=[{op:'test',path:'/rev',value:before.rev},{op:'add',path:`/fields/${oe}`,value:1},{op:'add',path:`/fields/${rw}`,value:1},{op:'add',path:'/fields/System.History',value:'M10 隔离机制验证：补齐 TFS 必填初始估计为 1h，作为测试 fixture 管理数据；不代表生产需求实际研发工时。用户已授权 260986 用于本次验证。'}];
 const r=await c.rawRequest(url,'PATCH',JSON.stringify(doc),{'Content-Type':'application/json-patch+json'});if(r.statusCode!==200)throw new Error(`测试估算 PATCH ${r.statusCode}`);patched=true;
}else if(before.fields[oe]!==1)throw new Error('已有其他估算，不覆盖');
const after=await get();if(after.fields[oe]!==1)throw new Error('估算回读不一致');
const report={at:new Date().toISOString(),task_id:process.env.MULTICA_TASK_ID,id:264845,parent:260986,fixture_estimate_hours:1,patched,before:{rev:before.rev,state:before.fields['System.State'],estimate:before.fields[oe]},after:{rev:after.rev,state:after.fields['System.State'],estimate:after.fields[oe],remaining:after.fields[rw]}};
fs.writeFileSync('M10-test-estimate-precondition.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
