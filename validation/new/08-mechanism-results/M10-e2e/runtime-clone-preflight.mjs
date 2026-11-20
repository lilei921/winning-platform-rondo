/** PR 排队时先在真实 Task 验证 API、Git clone 和自有临时目录清理；不执行归档或 TFS 写入。 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {RemoteArtifactReader,materializeDeliveryArtifacts,checkoutArchiveRoot} from '../../../../../../tools/rondo/dist/commands/delivery/remote-artifacts.js';
if(!process.env.MULTICA_TASK_ID)throw new Error('只能在真实 Multica Task 运行');
const fixture=JSON.parse(fs.readFileSync(new URL('./fixture-state.json',import.meta.url),'utf8'));
const key=Object.keys(process.env).find(k=>k.toLowerCase()==='path');const inherited=process.env[key]??'';
for(const k of Object.keys(process.env))if(k.toLowerCase()==='path')delete process.env[k];
process.env.PATH=`C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/cmd;C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/mingw64/bin;${inherited}`;
process.env.GIT_TERMINAL_PROMPT='0';
// 本次内网 HTTP 已获用户允许；只对子进程排除会阻滞 Git pack 的本机代理。
const noProxyKey=Object.keys(process.env).find(k=>k.toLowerCase()==='no_proxy');const noProxy=process.env[noProxyKey]??'';
if(noProxyKey)delete process.env[noProxyKey];process.env.NO_PROXY=[noProxy,new URL(fixture.root_url).hostname].filter(Boolean).join(',');
const r={task_id:process.env.MULTICA_TASK_ID,cwd:process.cwd(),at:new Date().toISOString()};
let snapshot,checkout;
try{
 snapshot=await materializeDeliveryArtifacts(new RemoteArtifactReader(fixture.root_url),{'analysis.source':JSON.stringify(fixture.analysis_source),'analysis.change_ref':fixture.change},fixture.branch.root);
 checkout=checkoutArchiveRoot(snapshot);r.root=checkout.paths.rootRepo;r.commit=snapshot.commit;
 const p=spawnSync('git',['-C',r.root,'status','--porcelain'],{encoding:'utf8',windowsHide:true});
 if(p.status!==0||p.stdout.trim())throw new Error('临时根仓不是干净快照');
 checkout.dispose();r.clone_deleted=!fs.existsSync(r.root);r.overall='PASS';
}catch(e){r.overall='FAIL';r.error=e.message;process.exitCode=1;}
finally{snapshot?.dispose();}
fs.writeFileSync(path.resolve('M10-clone-preflight.json'),JSON.stringify(r,null,2));console.log(JSON.stringify(r,null,2));
