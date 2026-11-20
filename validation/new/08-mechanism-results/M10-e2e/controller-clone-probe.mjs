/** 对照诊断：相同 Git/认证/浅克隆在控制端运行；不作为真实 Runtime 验收证据。 */
import fs from 'node:fs';
import {RemoteArtifactReader,materializeDeliveryArtifacts,checkoutArchiveRoot} from '../../../../../../tools/rondo/dist/commands/delivery/remote-artifacts.js';
const f=JSON.parse(fs.readFileSync(new URL('./fixture-state.json',import.meta.url),'utf8'));
const key=Object.keys(process.env).find(k=>k.toLowerCase()==='path');const inherited=process.env[key]??'';
for(const k of Object.keys(process.env))if(k.toLowerCase()==='path')delete process.env[k];
process.env.PATH=`C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/cmd;C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/mingw64/bin;${inherited}`;
const noProxyKey=Object.keys(process.env).find(k=>k.toLowerCase()==='no_proxy');const noProxy=process.env[noProxyKey]??'';
if(noProxyKey)delete process.env[noProxyKey];process.env.NO_PROXY=[noProxy,new URL(f.root_url).hostname].filter(Boolean).join(',');
const report={started_at:new Date().toISOString(),scope:'controller_diagnostic_only'};let snapshot;
try{snapshot=await materializeDeliveryArtifacts(new RemoteArtifactReader(f.root_url),{'analysis.source':JSON.stringify(f.analysis_source),'analysis.change_ref':f.change},f.branch.root);const c=checkoutArchiveRoot(snapshot);report.root=c.paths.rootRepo;report.commit=snapshot.commit;c.dispose();report.result='PASS';}
catch(e){report.result='FAIL';report.error=e.message;process.exitCode=1;}
finally{snapshot?.dispose();}
report.finished_at=new Date().toISOString();fs.writeFileSync(new URL('./controller-clone-probe.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
