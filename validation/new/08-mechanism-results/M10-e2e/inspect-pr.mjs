/** 只读记录隔离 PR 的完成失败与策略诊断；不绕过策略。 */
import fs from 'node:fs';
import {TfsClient} from '../../../../../../tools/rondo/dist/tfs/client.js';
const c=new TfsClient();
const root=c.config.serverUrl;
const project='d2983ec0-9b19-4137-839e-df27e4e43b12';
const result={at:new Date().toISOString()};
for(const [key,url] of Object.entries({
 pr:`${root}/_apis/git/repositories/b52a4fd8-ec61-4cb5-b2f3-c3b61e41da74/pullrequests/3773?api-version=4.1`,
 threads:`${root}/_apis/git/repositories/b52a4fd8-ec61-4cb5-b2f3-c3b61e41da74/pullrequests/3773/threads?api-version=4.1`,
 policies:`${root}/${project}/_apis/policy/evaluations?artifactId=${encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${project}/3773`)}&api-version=4.1-preview.1`
})){
 const r=await c.rawRequest(url,'GET');result[key]={status:r.statusCode,body:JSON.parse(r.body)};
}
fs.writeFileSync(new URL('./pr-diagnostic.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({pr:result.pr.body,threads:result.threads,policies:result.policies},null,2));
