/** 仅测试进程故障注入；成功路径全部调用真实 Rondo 客户端，不模拟外部成功响应。 */
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
const base='D:/UserProgram/winning-platform-monorepo/tools/rondo/dist';
const {MulticaClient}=await import(pathToFileURL(`${base}/clients/multica.js`).href);
const {TfsClient}=await import(pathToFileURL(`${base}/clients/tfs.js`).href);
const {UnknownError}=await import(pathToFileURL(`${base}/cli/errors.js`).href);
const mode=process.env.M10_FAULT,issue=process.env.M10_DELIVERY_ID;
let fired=false;
function fail(boundary){
 fired=true;fs.appendFileSync('M10-injected-failures.jsonl',JSON.stringify({at:new Date().toISOString(),mode,boundary,issue,task:process.env.MULTICA_TASK_ID})+'\n');
 throw new UnknownError(`M10_INJECTED_${mode}: ${boundary}`);
}
const originalMetadata=MulticaClient.prototype.setMetadata;
MulticaClient.prototype.setMetadata=function(id,key,value){
 if(!fired&&mode==='after_archive_push'&&id===issue&&key==='finalize.pending'&&JSON.parse(value).prepared_change_ref)fail('Git archive published; before prepared_change_ref metadata write');
 return originalMetadata.call(this,id,key,value);
};
const originalTfs=TfsClient.prototype.run;
TfsClient.prototype.run=async function(args,what){
 if(!fired&&mode==='during_writeback'&&args[0]==='workitem'&&args[1]==='set-state'&&args.includes('--complete-with-estimate'))fail('Task created/mapped/commit-linked; before first child state write');
 return originalTfs.call(this,args,what);
};
const originalStatus=MulticaClient.prototype.setStatus;
MulticaClient.prototype.setStatus=function(id,status,...rest){
 if(!fired&&mode==='during_complete'&&id===issue&&status==='done')fail('TFS writeback and summary persisted; before Issue done');
 return originalStatus.call(this,id,status,...rest);
};
