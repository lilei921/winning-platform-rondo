/** 无 Authorization 的真实 GET；仅核验匿名访问受拒，不代替低权限账号隔离验证。 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const url=new URL('http://tfs2018-web.winning.com.cn:8080/tfs/WN_Data_Platform/DP-01-%E6%95%B0%E6%8D%AE%E4%BB%93%E5%BA%93/_apis/git/repositories/winning-platform-monorepo/items');
Object.entries({path:'/README.md','versionDescriptor.versionType':'commit','versionDescriptor.version':'9a2d723a0b89615b6581a898567e4e4468bb3e0b','api-version':'4.1'}).forEach(([k,v])=>url.searchParams.set(k,v));
const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(30000)});
await response.arrayBuffer();
const result={timestamp:new Date().toISOString(),method:'GET',authorization_header_sent:false,status:response.status,content_type:response.headers.get('content-type'),anonymous_read_denied:[401,403].includes(response.status),low_privilege_identity_test:'NOT_RUN: user confirmed no low-privilege user',http_policy:'user explicitly approved current intranet HTTP for this validation; not general production deployment approval'};
fs.writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'M11-anonymous-read-evidence.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
