/** 仅建立 rondo-test 的 M10 隔离测试对象，真实交付事实由 Rondo 命令产生。 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {MulticaClient} from '../../../../../../tools/rondo/dist/clients/multica.js';
const dir=path.dirname(fileURLToPath(import.meta.url));
const fixture=JSON.parse(fs.readFileSync(path.join(dir,'fixture-state.json'),'utf8'));
const cli='C:/Users/lilei/.multica/bin/multica.exe';
const ws='60eb8cf4-31be-4a34-b744-8ef6a0bcf15d';
const mc=new MulticaClient({multica_cli:cli,workspace_id:ws});
const statePath=path.join(dir,'runtime-setup.json');
const s=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{};
const save=()=>fs.writeFileSync(statePath,JSON.stringify(s,null,2));
function call(args){const p=spawnSync(cli,[...args,'--workspace-id',ws,'--output','json'],{encoding:'utf8',windowsHide:true,timeout:60000});if(p.status!==0)throw new Error(p.stderr||p.stdout);return JSON.parse(p.stdout);}
if(!s.delivery){s.delivery=call(['issue','create','--title','M10 260986 远端归档收口与恢复测试','--status','todo','--description','用户授权的隔离 M10 Delivery fixture，非生产交付。Prepare、Writeback、Complete 仅由真实 Runtime 内的 Rondo 命令推进。']);save();}
if(!s.approval_comment){s.approval_at=new Date().toISOString();s.approval_comment=mc.addCommentContent(s.delivery.id,`M10 测试授权投影（非生产需求批准）\n用户明确授权：“继续解决 M10，补齐 Rondo 的远端归档工件读取适配，用 260986 在真实 Runtime 完整验证 Prepare → Writeback → Complete 和中断恢复。M11 先保留 NOT_RUN，能自主完成的直接推进，不用逐项确认。”\n据此建立隔离测试基线 ${fixture.approved_commit} / ${fixture.change}；测试无需额外 Verify Agent（verify_agent_required=false），不改变生产审批规则。候选仅为测试分支上的固定标记文件。`);save();}
if(!s.metadata_ready){
 const md={'tfs.id':'260986','tfs.type':'需求','tfs.url':'http://tfs2018-web.winning.com.cn:8080/tfs/wn_data_platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_workitems?id=260986&_a=edit',
 'analysis.change_ref':fixture.change,'analysis.change_kind':'corrective','analysis.source':JSON.stringify(fixture.analysis_source),'analysis.gate.result':'PASS',
 'analysis.human_approval':JSON.stringify({decision:'approved',by:'用户授权的 M10 测试 fixture',at:s.approval_at,comment_ref:s.approval_comment,verify_agent_required:false,source:fixture.analysis_source}),'verify_agent.required':'false',
 'dev.dispatch':JSON.stringify([{dispatch_key:'m10-runtime-260986',change_ref:fixture.change,task_refs:['1.1'],active:true,analysis_source:fixture.analysis_source}]),
 'pr_prep':JSON.stringify([{repo_key:'frame',candidate_commit:fixture.candidate}]),
 current_pr:JSON.stringify([{repo_key:'frame',pr_id:fixture.pr.id,pr_url:fixture.pr.url,source_branch:fixture.branch.source,target_branch:fixture.branch.target}])};
 for(const [k,v] of Object.entries(md))mc.setMetadata(s.delivery.id,k,v);
 s.metadata_ready=true;save();
}
const mode=process.argv[2];
if(['prepare','finish'].includes(mode)&&!s[mode]){
 const preflight=mode==='prepare'?`先执行 node D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-clone-preflight.mjs 并报告结果。当前隔离 PR #3773 在服务端 queued；本次先只执行 clone preflight，等待控制端下条消息确认 PR 真实完成后，再运行下面的完整 Prepare 驱动。\n\n`:'';
 const description=`# M10 真实 Runtime ${mode}\n\n用户已授权使用 TFS 260986 和隔离测试分支连续完成 M10。这是执行测试任务，无需额外确认。\n\n${preflight}在当前 Task workdir 运行：\n\nnode D:/UserProgram/winning-platform-monorepo/projects/multica/validation/new/08-mechanism-results/M10-e2e/runtime-driver.mjs ${mode} ${s.delivery.identifier}\n\n脚本使用工作区已构建 Rondo、真实 Multica/TFS/OpenSpec/Git，并在进程边界注入一次失败验证恢复；仅子进程 PATH 使用已核验 BusyBox MinGit。保持现有 sandbox/凭据/Agent 配置。不要另行创建 Agent；不要手动写 Delivery Issue 的状态、prepared、pending、tfs_written 或摘要事实；不要更改脚本和源码。若脚本 FAIL，报告具体证据与失败，保留现场等待本轮控制端修复。成功后报告证据完整路径及 SHA256，并作为本 Runner Issue 附件发布。不要修改 Delivery ${s.delivery.identifier} 的状态；当前 Runner 可以转 in_review。`;
 const file=path.join(dir,`${mode}-task.md`);fs.writeFileSync(file,description);
 s[mode]=call(['issue','create','--title',`M10 ${mode} 真实 Runtime 与中断恢复`,'--status','todo','--description-file',file]);save();
}
if(['prepare','finish'].includes(mode)&&!s[`${mode}_assigned`]){
 const agent=mode==='prepare'?'d6120bc6-9f95-4df7-9582-dba83fdc856e':'3ca0a964-2db2-4f21-a816-1f21d05b27a9';
 s[`${mode}_assignment`]=call(['issue','assign',s[mode].id,'--to-id',agent]);s[`${mode}_assigned`]=true;save();
}
console.log(JSON.stringify({delivery:{id:s.delivery.id,key:s.delivery.identifier},runner:s[mode]?{id:s[mode].id,key:s[mode].identifier}:null},null,2));
