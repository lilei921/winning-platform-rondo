/** M03：在真实无 Project Task 中执行已安装 Rondo；仅 GET，不改变测试 Issue Metadata。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const [positive, invalid, output = 'M03-runtime-evidence.json'] = process.argv.slice(2);
if (!positive || !invalid) throw new Error('需要正向与无效 Commit 测试 Issue');
const base = 'D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist';
const { TfsClient } = await import(pathToFileURL(`${base}/tfs/client.js`).href);
const client = new TfsClient();
const config = path.resolve('m03-runtime-config.json');
fs.writeFileSync(config, JSON.stringify({runtime:{multica_cli:'C:/Users/lilei/.multica/bin/multica.exe',workspace_id:'60eb8cf4-31be-4a34-b744-8ef6a0bcf15d'}}));
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const report = {timestamp:new Date().toISOString(), cwd:process.cwd(), local_git_exists:fs.existsSync('.git'), credentials_present:Boolean(client.config.pat), commands:[], independent_reads:[], checks:[]};
function check(name, value) { report.checks.push({name,result:value?'PASS':'FAIL'}); }
function read(issue, file) {
  const args = [`${base}/index.js`,'analysis','read','--config',config,'--issue',issue,'--file',file];
  const p = spawnSync(process.execPath,args,{encoding:'utf8',timeout:120000,windowsHide:true});
  let result; try { result=JSON.parse(p.stdout); } catch { result={result:'UNPARSEABLE',length:p.stdout?.length??0}; }
  const content=result.content; delete result.content;
  const item={issue,file,argv:args,exit:p.status,signal:p.signal,error:p.error?.code,response:result,...(typeof content==='string'?{content_sha256:sha(content),content_bytes:Buffer.byteLength(content)}:{})};
  report.commands.push(item); return {item,content};
}
try {
  check('no_local_git_checkout',!report.local_git_exists);
  const good=read(positive,'tasks.md');
  check('fixed_source_cli_pass',good.item.exit===0&&good.item.response.result==='PASS');
  const source=good.item.response.source;
  if (source && typeof good.content==='string') {
    for (const version of ['4.0','4.1']) {
      const url=new URL(source.repo_url.replace('/_git/','/_apis/git/repositories/')+'/items');
      Object.entries({path:`/openspec/changes/${source.change_ref}/tasks.md`,includeContent:'true','versionDescriptor.versionType':'commit','versionDescriptor.version':source.commit,'api-version':version}).forEach(([k,v])=>url.searchParams.set(k,v));
      const res=await client.rawRequest(url.href,'GET');
      let body; try {body=JSON.parse(res.body);} catch {body={};}
      const same=res.statusCode===200&&body.commitId===source.commit&&body.content===good.content&&body.objectId===good.item.response.object_id;
      report.independent_reads.push({api_version:version,status:res.statusCode,commit:body.commitId,path:body.path,object_id:body.objectId,content_sha256:typeof body.content==='string'?sha(body.content):null,result:same?'PASS':'FAIL'});
      check(`independent_api_${version}_matches`,same);
    }
  }
  const absent=read(positive,'m03-deliberately-absent-20261113.md');
  check('missing_file_closed',absent.item.exit===2&&absent.item.response.result==='FAIL'&&absent.content===undefined);
  const bad=read(invalid,'tasks.md');
  check('invalid_commit_closed',[2,3].includes(bad.item.exit)&&['FAIL','UNKNOWN'].includes(bad.item.response.result)&&bad.content===undefined);
  const traversal=read(positive,'../tasks.md');
  check('traversal_closed',[2,3].includes(traversal.item.exit)&&['FAIL','UNKNOWN'].includes(traversal.item.response.result)&&traversal.content===undefined);
} catch(e) {report.error=e.message;check('unexpected_error',false);}
report.overall=report.checks.every(x=>x.result==='PASS')&&report.checks.length===7?'PASS':'FAIL';
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output:path.resolve(output),overall:report.overall,checks:report.checks},null,2));
if(report.overall!=='PASS')process.exitCode=1;
