import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withCollectionWriterLock } from "./collection-lock.js";

test("Collection Writer 持有原子锁时拒绝并发，异常后释放允许恢复",async t=>{
  const prev=process.env.RONDO_TFS_COLLECTION_LOCK_DIR;
  const dir=mkdtempSync(join(tmpdir(),"rondo-tfs-lock-test-"));
  process.env.RONDO_TFS_COLLECTION_LOCK_DIR=dir;
  t.after(()=>{
    if(prev===undefined)delete process.env.RONDO_TFS_COLLECTION_LOCK_DIR;
    else process.env.RONDO_TFS_COLLECTION_LOCK_DIR=prev;
    rmSync(dir,{recursive:true,force:true});
  });
  const server="http://tfs.example/tfs/C";
  let begin!: () => void; let finish!: () => void;
  const began = new Promise<void>(resolve => { begin = resolve; });
  const stopped = new Promise<void>(resolve => { finish = resolve; });
  const writer = withCollectionWriterLock(server, async () => {
    assert.equal(await withCollectionWriterLock(server, async () => 42), 42);
    begin();
    await stopped;
  });
  await began;
  await assert.rejects(withCollectionWriterLock(server, async () => true), /已被占用/);
  finish();
  await writer;
  await assert.rejects(withCollectionWriterLock(server,async()=>{throw new Error("injected")}),/injected/);
  assert.equal(await withCollectionWriterLock(server,async()=>42),42);
});
