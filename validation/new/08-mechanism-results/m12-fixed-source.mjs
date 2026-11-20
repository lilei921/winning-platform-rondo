/** M12 降级 PoC 的权威读取：只用固定 SHA TFS API，不读取本地业务仓。 */
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
const {TfsClient}=await import(pathToFileURL('D:/UserApp/nvm/node_global/node_modules/@winning/rondo/dist/tfs/client.js').href);
const client=new TfsClient();
const commit='dc6ff47ff2f4e8f24c0db4c3efe88dcf92c5bf7a';
const file='/winning-dps-df-frame-service/src/main/java/com/winning/dps/df/frame/service/uniauth/platform/PermissionPlatService.java';
const url=new URL(`${client.config.serverUrl}/WiNEX%20DataFactory/_apis/git/repositories/winning-dps-df-frame/items`);
Object.entries({path:file,includeContent:'true','versionDescriptor.versionType':'commit','versionDescriptor.version':commit,'api-version':'4.1'}).forEach(([k,v])=>url.searchParams.set(k,v));
const res=await client.rawRequest(url.href,'GET');
const body=JSON.parse(res.body);
if(res.statusCode!==200||body.commitId!==commit||body.path!==file||typeof body.content!=='string')throw new Error('fixed SHA API read failed');
console.log(JSON.stringify({status:res.statusCode,commit:body.commitId,path:body.path,object_id:body.objectId,sha256:crypto.createHash('sha256').update(body.content).digest('hex'),lines:body.content.split(/\r?\n/).slice(110,124)}));
