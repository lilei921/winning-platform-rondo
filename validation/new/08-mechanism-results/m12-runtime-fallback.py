"""真实 Runtime 运行的可选 MCP 降级机制 PoC；故障仅注入本测试进程，不修改服务。"""
import hashlib, importlib.util, json, os, pathlib, re, subprocess

BASE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('m12_readonly',BASE/'m12-index-snapshot.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
audit=json.loads((BASE/'M12-index-commit-audit.json').read_text(encoding='utf-8'))
assert audit['index_content_matches_commit'] and audit['compared']==476
commit=audit['commit']
report={'level':'isolated mechanism PoC in real Runtime; not production orchestration acceptance','cwd':os.getcwd(),'task_id':os.getenv('MULTICA_TASK_ID'),'local_git_exists':pathlib.Path('.git').exists(),'cases':[]}
for mode in ['normal','mcp_unavailable','stale_index']:
    graph=None;reason=None;context={}
    try:
        if mode=='mcp_unavailable':
            raise ConnectionError('injected optional MCP transport failure')
        if mode=='stale_index':
            # 只替换此次测试的版本声明；旧版本图谱不得升级为当前 Commit 的事实。
            claimed_commit='5e7968ae04dacda18901042a431544ec8e59db67'
            if claimed_commit!=commit: raise ValueError('injected index commit differs from requested commit')
        rpc,info=module.session('codegraph-remote')
        reply=rpc('tools/call',{'name':'codegraph_explore','arguments':{'projectPath':'/root/winning-platform-monorepo/winning-dps-df-frame','query':'PermissionPlatService getPermissions','maxFiles':1}})
        if reply.get('isError'): raise RuntimeError('MCP returned isError')
        graph='\n'.join(x.get('text','') for x in reply.get('content',[]) if x.get('type')=='text')
        context={'service':info,'graph_response_sha256':hashlib.sha256(graph.encode()).hexdigest(),'index_snapshot_audit_commit':commit}
    except Exception as exc:
        reason={'type':type(exc).__name__,'message':str(exc) if mode!='normal' else 'optional MCP request failed'}
    # 故障后由同一流程继续权威 API；不回退本地文件、不改变 Commit。
    p=subprocess.run(['node',str(BASE/'m12-fixed-source.mjs')],capture_output=True,text=True,encoding='utf-8',timeout=60)
    if p.returncode: raise RuntimeError('TFS fixed source subprocess failed')
    source=json.loads(p.stdout)
    lines=source.pop('lines')
    match=None
    if graph is not None:
        extracted={int(m[0]):m[1] for m in re.findall(r'^(\d+)\t(.*)$',graph,re.M) if 111<=int(m[0])<=124}
        match=len(extracted)==14 and [extracted[n] for n in range(111,125)]==lines
    passed=source['commit']==commit and (match is True if mode=='normal' else graph is None and reason is not None)
    report['cases'].append({'mode':mode,'injection':'none' if mode=='normal' else 'test-process-only','degraded':graph is None,'optional_error':reason,'graph_used_as_fact':False,'graph_fragment_matches':match,'context':context,'authoritative_source':'TFS fixed-commit API','source':source,'result':'PASS' if passed else 'FAIL'})
report['overall']='PASS' if not report['local_git_exists'] and all(x['result']=='PASS' for x in report['cases']) else 'FAIL'
pathlib.Path('M12-runtime-fallback-evidence.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
if report['overall']!='PASS': raise SystemExit(1)
