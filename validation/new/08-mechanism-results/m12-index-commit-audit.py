"""逐个校验索引文件 Hash 与固定 Git Commit 的内容寻址对象；不修改仓库或索引。"""
import hashlib, json, pathlib, sqlite3, subprocess

OUT=pathlib.Path(__file__).resolve().parent
ROOT=pathlib.Path(__file__).resolve().parents[5]
REPO=ROOT/'winning-dps-df-frame'
COMMIT='dc6ff47ff2f4e8f24c0db4c3efe88dcf92c5bf7a'
db=sqlite3.connect((ROOT/'.tmp/m12-index-snapshot.db').as_uri()+'?mode=ro',uri=True)
metadata=dict(db.execute('select key,value from project_metadata'))
files=db.execute('select path,content_hash,size,errors from files order by path').fetchall()
nodes_paths={x[0] for x in db.execute('select distinct file_path from nodes')}
def git(*args,**kwargs):
    return subprocess.run(['git','-C',str(REPO),*args],capture_output=True,check=True,**kwargs).stdout
tree={}
for entry in git('ls-tree','-rz','--full-tree',COMMIT).split(b'\0'):
    if not entry: continue
    info,name=entry.split(b'\t',1)
    mode,kind,oid=info.decode().split()
    if kind=='blob': tree[name.decode('utf-8')] = oid
selected=[(name,index_hash,size,errors,tree[name]) for name,index_hash,size,errors in files if name in tree]
raw=git('cat-file','--batch',input=('\n'.join(x[4] for x in selected)+'\n').encode())
offset=0
records=[]
for name,index_hash,size,errors,oid in selected:
    end=raw.index(b'\n',offset)
    header=raw[offset:end].decode().split()
    length=int(header[2]); content=raw[end+1:end+1+length]; offset=end+length+2
    actual=hashlib.sha256(content).hexdigest()
    blob=hashlib.sha1(b'blob '+str(length).encode()+b'\0'+content).hexdigest()
    records.append({'path':name,'git_blob':oid,'git_object_verified':blob==oid,'indexed_sha256':index_hash,'commit_content_sha256':actual,'match':actual==index_hash,'indexed_errors':errors})
untracked=[{'path':name,'indexed_sha256':h} for name,h,_,_ in files if name not in tree]
report={'commit':COMMIT,'repository':str(REPO),'metadata':metadata,'files_indexed':len(files),'files_at_commit':len(tree),'compared':len(records),'matching':sum(x['match'] for x in records),'all_git_objects_verified':all(x['git_object_verified'] for x in records),'indexed_paths_absent_at_commit':untracked,'node_paths_outside_files':sorted(nodes_paths-{x[0] for x in files}),'mismatches':[x for x in records if not x['match']],'records':records}
report['index_content_matches_commit']=all(x['match'] and x['git_object_verified'] for x in records) and not untracked and not report['node_paths_outside_files']
(OUT/'M12-index-commit-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='records'},ensure_ascii=False,indent=2))
