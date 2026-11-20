// 固定授权测试对象；不构造 Task 身份、不模拟成功结果、不直接写交付标记。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MulticaClient } from '../../../../../tools/rondo/dist/clients/multica.js';
import { TfsClient } from '../../../../../tools/rondo/dist/tfs/client.js';
import { readTfsHistory, deliveryCommentReference } from '../../../../../tools/rondo/dist/commands/tfs/delivery-comment.js';
const stage = process.argv[2], issueKey = 'TT-6';
if (!['interrupt', 'recover'].includes(stage) || !process.env.MULTICA_TASK_ID ||
    process.env.MULTICA_AGENT_ID !== '9f2417ea-5029-49af-b97e-3ee6f826009e' ||
    process.env.MULTICA_WORKSPACE_ID !== '3158546f-5b79-4042-baec-20cdac7d9d31') throw new Error('仅允许测试工作区真实 PR Status Sync Task');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'tools/rondo/build/08a-runtime/isolated-registry.json'), 'utf8'));
if (process.env.MULTICA_CLI_PATH) cfg.runtime.multica_cli = process.env.MULTICA_CLI_PATH;
delete cfg.runtime.multica_profile;
const config = path.resolve('08a-runtime-registry.json');
fs.writeFileSync(config, JSON.stringify(cfg, null, 2));
const mc = new MulticaClient(cfg.runtime), tfs = new TfsClient();
const output = path.resolve(`08a-${stage}-evidence.json`);
const report = { stage, task_id: process.env.MULTICA_TASK_ID, agent_id: process.env.MULTICA_AGENT_ID, cwd: process.cwd(), checks: [], commands: [], snapshots: [] };
const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
function check(name, yes) { report.checks.push({name, result:yes?'PASS':'FAIL'}); save(); if (!yes) throw new Error(name); }
async function snapshot(label) {
  const issue = mc.getIssue(issueKey);
  check('fixed_test_bug_identity', issue.id === '01a1d943-7e6e-7cb1-bd26-7957ae333b5e' && issue.metadata['tfs.id'] === '265022');
  const r = await tfs.rawRequest(`${tfs.config.serverUrl}/_apis/wit/workitems/265022?api-version=4.1`, 'GET');
  if(r.statusCode !== 200) throw new Error('TFS snapshot failed');
  const wi = JSON.parse(r.body), history = await readTfsHistory(265022);
  const reference = deliveryCommentReference(issue);
  const summaries = mc.listComments(issue.id).filter(x => x.content?.startsWith('## Bug 修复交付完成'));
  const s = { label, status:issue.status, metadata:issue.metadata, tfs_rev:wi.rev, tfs_state:wi.fields['System.State'],
    comments:history.filter(x => x.includes(reference)).length, summary_ids:summaries.map(x=>x.id) };
  report.snapshots.push(s); save(); return s;
}
function run(label, args, fault) {
  const env = {...process.env};
  if(fault) env.RONDO_08A_FAULT=fault; else delete env.RONDO_08A_FAULT;
  env.RONDO_GIT_EXECUTABLE='C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/cmd/git.exe';
  env.RONDO_GIT_PATH_PREFIX='C:/Users/lilei/.multica/tools/mingit-busybox-2.54.0/mingw64/bin';
  const argv=[...(fault?['--import',new URL('./inject-failure.mjs',import.meta.url).href]:[]),path.join(root,'tools/rondo/dist/index.js'),...args,'--issue',issueKey,'--config',config];
  const p=spawnSync(process.execPath,argv,{encoding:'utf8',env,windowsHide:true,timeout:240000,maxBuffer:8*1024*1024});
  fs.writeFileSync(`${label}.stdout.json`,p.stdout??''); fs.writeFileSync(`${label}.stderr.log`,p.stderr??'');
  let response;try{response=JSON.parse(p.stdout);}catch{response=null;}
  const r={label,exit:p.status,response,error:p.error?.code};report.commands.push(r);save();return r;
}
try {
  const runner=mc.getIssue(process.env.MULTICA_ISSUE_ID || process.argv[3]);
  check('runner_has_no_project', !runner.project_id);
  check('no_local_checkout', !fs.existsSync('.git') && !fs.existsSync('winning-platform-monorepo'));
  const before=await snapshot('before');
  if(stage==='interrupt') {
    const sync=run('reconcile',['pr','reconcile-status']);
    check('sync_confirms_finalize',sync.exit===0 && sync.response.actions?.some(x=>['finalize','resume_finalize'].includes(x.action)));
    const p=run('prepare',['delivery','finalize','--phase','prepare']);
    check('bug_prepared',p.exit===0 && p.response.status==='prepared');
    const premature=run('complete-before-writeback',['delivery','finalize','--phase','complete']);
    check('complete_rejects_unwritten',premature.exit!==0);
    const crash=run('writeback-crashed',['tfs','writeback'],'crash-after-comment');
    check('crash_after_real_comment',crash.exit===86);
    const partial=await snapshot('comment-written-marker-absent');
    check('exactly_one_comment_without_marker',partial.comments===1 && partial.metadata['delivery.tfs_written']!=='true');
    check('partial_not_done',partial.status!=='done' && partial.tfs_state==='已解决');
  } else {
    check('prior_runtime_comment_exists',before.comments===1 && before.metadata['delivery.tfs_written']!=='true' && before.status!=='done');
    const p=run('prepare-reentry',['delivery','finalize','--phase','prepare']);check('prepare_reentry_pass',p.exit===0);
    const fail=run('marker-save-failed',['tfs','writeback'],'marker-save-fails');check('save_failure_observed',fail.exit===3 && JSON.stringify(fail.response).includes('08A_INJECTED'));
    const partial=await snapshot('marker-save-failed');check('comment_not_duplicated_after_save_failure',partial.comments===1 && partial.metadata['delivery.tfs_written']!=='true');
    const recovered=run('writeback-recovered',['tfs','writeback']);check('writeback_recovers',recovered.exit===0 && recovered.response.result==='PASS');
    const written=await snapshot('written');check('existing_comment_reused',written.comments===1 && written.metadata['delivery.tfs_written']==='true' && written.tfs_rev===before.tfs_rev);
    const failedSummary=run('summary-id-save-failed',['delivery','finalize','--phase','complete'],'summary-id-fails');check('summary_id_failure_observed',failedSummary.exit===3);
    const summary=await snapshot('summary-without-id');check('summary_published_without_done',summary.summary_ids.length===1 && !summary.metadata['delivery.summary_comment_id'] && summary.status!=='done');
    const completed=run('complete-recovered',['delivery','finalize','--phase','complete']);check('complete_recovers',completed.exit===0 && completed.response.status==='done');
    const done=await snapshot('done');check('one_summary_done_no_pending',done.status==='done' && !done.metadata['finalize.pending'] && done.summary_ids.length===1 && done.summary_ids[0]===summary.summary_ids[0]);
    const replay=run('complete-replay',['delivery','finalize','--phase','complete']);check('done_replay_noop',replay.exit===0 && replay.response.already==='done');
    const final=await snapshot('replayed');check('replay_no_tfs_or_summary_writes',final.tfs_rev===before.tfs_rev && final.comments===1 && final.summary_ids.length===1);
  }
  report.result='PASS';
} catch(e) { report.result='FAIL';report.error=e.message;process.exitCode=1; }
save();console.log(JSON.stringify({result:report.result,error:report.error,evidence:output,checks:report.checks},null,2));
