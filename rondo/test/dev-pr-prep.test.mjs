import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validatePrFacts } from "../dist/commands/pr/prepare.js";
import { verifyAndExecuteValidation } from "../dist/commands/pr/validation.js";
const valid=()=>({validation:{command:[process.execPath,"-e","process.exit(0)"],summary:"actual validation"},code_review:{result:"PASS",summary:"review"},blockers:[],description:"professional description"});
test("common Facts enforce actual command for Requirement, allow Bug evidence-only",()=>{
  assert.deepEqual(validatePrFacts(valid(),false).code_review.findings,[]);
  const f=valid();delete f.validation.command;
  assert.throws(()=>validatePrFacts(f,false),/command/);
  assert.throws(()=>validatePrFacts(f,true),/PASS/);
  f.validation.result="PASS";
  assert.doesNotThrow(()=>validatePrFacts(f,true));
  assert.equal(validatePrFacts(valid(),false).validation.result,undefined);
  assert.equal(validatePrFacts(valid(),true).validation.result,undefined);
  for(const bad of [null,[],[""],["node",42]]) {f.validation.command=bad;assert.throws(()=>validatePrFacts(f,true),/command/);}
});
test("public PR Facts reject FAIL, unresolved blockers and nonblocking risk without evidence",()=>{
  for(const f of [
    {...valid(),validation:{...valid().validation,result:"FAIL"}},
    {...valid(),blockers:["unresolved"]},
    {...valid(),description:""},
    {...valid(),code_review:{...valid().code_review,findings:[{blocking:false,resolved:false}]}},
    {...valid(),code_review:{...valid().code_review,findings:[{blocking:true,resolved:false}]}}
  ]) assert.throws(()=>validatePrFacts(f,false));
  assert.doesNotThrow(()=>validatePrFacts({...valid(),code_review:{...valid().code_review,findings:[{blocking:false,risk_note:"known"}]}},false));
});
test("validation executes in exact authorized Git checkout, rejects failure, changes and sibling checkout",t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),"rondo-pr-validation-")));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const root=join(dir,"repo"),other=join(dir,"other");mkdirSync(root);mkdirSync(other);
  const url="http://tfs.test/tfs/C/P/_git/biz";
  const git=(cwd,...args)=>execFileSync("git",args,{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git(root,"init");git(root,"remote","add","origin",url);writeFileSync(join(root,"a.txt"),"old");git(root,"add",".");git(root,"-c","user.name=test","-c","user.email=test@example.com","commit","-m","fixture");
  const sha=git(root,"rev-parse","HEAD");
  assert.doesNotThrow(()=>verifyAndExecuteValidation(root,root,url,sha,[process.execPath,"-e","process.exit(0)"]));
  assert.throws(()=>verifyAndExecuteValidation(root,root,url,sha,[process.execPath,"-e","process.exit(7)"]),/失败/);
  assert.throws(()=>verifyAndExecuteValidation(root,other,url,sha,[process.execPath,"-e","process.exit(0)"]),/目录/);
  assert.throws(()=>verifyAndExecuteValidation(root,root,url,sha,[process.execPath,"-e","require('fs').writeFileSync('a.txt','changed')"]),/发生变化/);
});
