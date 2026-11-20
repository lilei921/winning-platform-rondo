"""仅经现有 MCP read_media_file 读取索引快照；凭据只在内存用于已配置服务，不写入报告。"""
import base64, hashlib, json, os, pathlib, sqlite3, tomllib, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[5]
OUT = pathlib.Path(__file__).resolve().parent
CFG = tomllib.loads(pathlib.Path('C:/Users/lilei/.codex/config.toml').read_text(encoding='utf-8'))

def session(name):
    conf = CFG['mcp_servers'][name]
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'}
    headers.update(conf.get('http_headers', {}))
    for key, var in conf.get('env_http_headers', {}).items():
        headers[key] = os.environ[var]
    if conf.get('bearer_token_env_var'):
        headers['Authorization'] = 'Bearer ' + os.environ[conf['bearer_token_env_var']]
    counter = 0
    def rpc(method, params, notification=False):
        nonlocal counter
        counter += 1
        body = {'jsonrpc':'2.0','method':method,'params':params}
        if not notification: body['id'] = counter
        req = urllib.request.Request(conf['url'], data=json.dumps(body).encode(), headers=headers, method='POST')
        with urllib.request.urlopen(req, timeout=120) as response:
            if response.headers.get('mcp-session-id'):
                headers['Mcp-Session-Id'] = response.headers['mcp-session-id']
            text = response.read().decode()
        if not text: return {}
        if text.lstrip().startswith('{'): parsed = json.loads(text)
        else:
            messages = [json.loads(line[5:].strip()) for line in text.splitlines() if line.startswith('data:')]
            parsed = next(x for x in messages if x.get('id') == counter)
        if 'error' in parsed: raise RuntimeError('MCP RPC error code '+str(parsed['error'].get('code')))
        return parsed.get('result',{})
    info = rpc('initialize',{'protocolVersion':'2025-03-26','capabilities':{},'clientInfo':{'name':'m12-readonly-validation','version':'1'}})
    headers['Mcp-Protocol-Version'] = info.get('protocolVersion','2025-03-26')
    rpc('notifications/initialized',{},True)
    return rpc, info.get('serverInfo')

if __name__ == '__main__':
    report = {'services':{},'method':'read_media_file','index_commit':None}
    for name in ['filesystem-remote','codegraph-remote','ripgrep-remote']:
        rpc, info = session(name)
        report['services'][name] = info
        if name != 'filesystem-remote': continue
        result = rpc('tools/call',{'name':'read_media_file','arguments':{'path':'/root/winning-platform-monorepo/winning-dps-df-frame/.codegraph/codegraph.db'}})
        if result.get('isError'): raise RuntimeError('MCP read_media_file failed')
        block = next(x for x in result['content'] if x.get('type') == 'resource')
        data = base64.b64decode(block['resource']['blob'])
        dest = ROOT / '.tmp/m12-index-snapshot.db'
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(data)
        report.update({'snapshot':str(dest),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        db = sqlite3.connect(dest.as_uri()+'?mode=ro',uri=True)
        report['quick_check'] = db.execute('pragma quick_check').fetchone()[0]
        report['schema'] = db.execute("select name,sql from sqlite_master where type='table'").fetchall()
        db.close()
    (OUT/'M12-index-snapshot.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
