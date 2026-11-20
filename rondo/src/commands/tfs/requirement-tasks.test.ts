import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FailError, UnknownError } from "../../cli/errors.js";
import {
  validateRequirementTaskPlan, ensurePlannedDeliveryTasks, findExistingPlannedTasks,
  type PlannedCommit, type RequirementTaskPlan,
} from "./requirement-tasks.js";

const tasksMd = "# Tasks\n- [x] 1.1 Implement API\n- [x] 1.2 UI\n- [x] 2.1 Verify\n";
const candidate = (i: number): PlannedCommit => ({ repo_key: "backend", sha: String(i + 1).repeat(40) });
const planFor = (count: number): RequirementTaskPlan => ({
  tasks: Array.from({ length: count }, (_, i) => ({
    summary: "交付功能 " + (i + 1),
    estimate_hours: [0.5, 1, 2, 3, 4][i],
    source_refs: ["1.1", "1.2"],
    commits: [candidate(i)],
  })),
});
const available = (count: number): PlannedCommit[] => Array.from({length:count}, (_,i)=>candidate(i));

function fakeTfs() {
  const parent = { id: 42, title: "住院病案质量指标优化", type: "需求", project: "Hospital",
    state: "活动", childIds: [] as number[] };
  const children: any[] = [];
  let nextId = 100;
  let creates = 0;
  let throwAfterCreate = false;
  const clients = {
    async tfsQuery(wiql: string) {
      if (wiql.includes(" IN (")) {
        const ids = wiql.split(" IN (")[1].split(")")[0].split(",").map(Number);
        return children.filter(c => ids.includes(c.id));
      }
      if (wiql.includes("= 42")) return [{ ...parent }];
      return [];
    },
    async tfsCreateTask(options: any) {
      creates++;
      const description = readFileSync(options.descriptionFile, "utf8");
      const entry = {
        id: nextId++, title: options.title, parentId: 42, type: "任务", project: "Hospital",
        originalEstimate: options.estimate, state: "活动", fields: {"System.Description": description},
        artifactLinks: [], remainingWork: options.estimate, completedWork: null,
      };
      children.push(entry); parent.childIds.push(entry.id);
      if (throwAfterCreate) {
        throwAfterCreate = false;
        throw new UnknownError("创建 Task 响应丢失");
      }
      return { id: entry.id };
    },
  };
  return {clients, parent, children, get creates(){return creates}, loseNextResponse() {throwAfterCreate = true}};
}

test("1/3/5 个 TFS 子任务有效，按提交数量、来源和 0.5–4h 估时控制", async () => {
  for (const count of [1, 3, 5]) {
    const plan = validateRequirementTaskPlan(planFor(count), tasksMd, available(count));
    const tfs = fakeTfs();
    const first = await ensurePlannedDeliveryTasks(tfs.clients as any, "WIN-42", "case-42", 42, plan);
    assert.equal(first.ids.length, count);
    assert.equal(first.created.length, count);
    assert.equal(new Set(first.ids).size, count);
    assert.deepEqual(tfs.children.map(c=>c.title), plan.tasks.map(t=>"住院病案质量指标优化 - "+t.summary));
    assert.deepEqual(tfs.children.map(c=>c.originalEstimate), plan.tasks.map(t=>t.estimate_hours));
    const second = await ensurePlannedDeliveryTasks(tfs.clients as any, "WIN-42", "case-42", 42, plan);
    assert.deepEqual(second.ids, first.ids);
    assert.equal(second.created.length, 0);
    assert.equal(tfs.creates, count);
  }
});

test("一个 Task 允许多个不同 Commit；一个 Commit 不能分给不同 Task", () => {
  const one = planFor(1);
  one.tasks[0].commits.push(candidate(1));
  assert.equal(validateRequirementTaskPlan(one, tasksMd, available(2)).tasks[0].commits.length, 2);
  const duplicate = planFor(2);
  duplicate.tasks[1].commits = [candidate(0)];
  assert.throws(()=>validateRequirementTaskPlan(duplicate, tasksMd, available(2)), FailError);
});

test("不能超过真实 Commit 数、不能 0 或 6 个 Task、估时越界、引用缺失、伪造 SHA 或任务结构非法", () => {
  assert.throws(()=>validateRequirementTaskPlan({tasks:[]},tasksMd,available(1)), FailError);
  assert.throws(()=>validateRequirementTaskPlan(planFor(2),tasksMd,available(1)), FailError);
  assert.throws(()=>validateRequirementTaskPlan({tasks:planFor(5).tasks.concat([planFor(1).tasks[0]])},tasksMd,available(5)), FailError);
  for(const estimate of [0.4,4.1,NaN,Infinity,"2"]) {
    const input:any = planFor(1); input.tasks[0].estimate_hours = estimate;
    assert.throws(()=>validateRequirementTaskPlan(input,tasksMd,available(1)), FailError);
  }
  const refs = planFor(1); refs.tasks[0].source_refs = ["99.9"];
  assert.throws(()=>validateRequirementTaskPlan(refs,tasksMd,available(1)), FailError);
  const fake = planFor(1); fake.tasks[0].commits=[{repo_key:"other",sha:"a".repeat(40)}];
  assert.throws(()=>validateRequirementTaskPlan(fake,tasksMd,available(1)), FailError);
  assert.throws(()=>validateRequirementTaskPlan({tasks:[null]},tasksMd,available(1)), FailError);
});

test("创建回执丢失后按父链+Description 稳定标识认领，不重复 POST", async () => {
  const plan = planFor(1); const tfs = fakeTfs();
  tfs.loseNextResponse();
  await assert.rejects(ensurePlannedDeliveryTasks(tfs.clients as any,"WIN-42","case-42",42,plan), UnknownError);
  const recovered = await ensurePlannedDeliveryTasks(tfs.clients as any,"WIN-42","case-42",42,plan);
  assert.equal(recovered.reused.length,1);
  assert.equal(recovered.created.length,0);
  assert.equal(tfs.creates,1);
});

test("人工同名、旧 Delivery Task 或估时修改、重复稳定身份均禁止认领", async () => {
  for (const kind of ["name","old","estimate","duplicate"]) {
    const plan = planFor(1); const tfs = fakeTfs();
    const entry: any = {
      id: 101, title: "住院病案质量指标优化 - 交付功能 1", parentId:42, type:"任务",
      originalEstimate:0.5, fields:{"System.Description":"Multica Delivery Task: WIN-42/1 (parent=42)\nOpenSpec Change: case-42"},
    };
    if (kind === "name") entry.fields["System.Description"] = "Manual task";
    if (kind === "old") entry.title = "[WIN-42 Delivery] 研发交付";
    if (kind === "estimate") entry.originalEstimate = 4;
    tfs.children.push(entry); tfs.parent.childIds.push(entry.id);
    if (kind === "duplicate") {
      tfs.children.push({...entry,id:102}); tfs.parent.childIds.push(102);
    }
    await assert.rejects(findExistingPlannedTasks(tfs.clients as any,"WIN-42","case-42",42,plan), FailError);
  }
});

test("计划可不选与本次业务任务无关的 PR Commit，但不可伪造或重复选用", () => {
  const plan = planFor(1);
  assert.equal(validateRequirementTaskPlan(plan, tasksMd, available(2)).tasks.length, 1);
  const duplicate = planFor(2);
  duplicate.tasks[1].commits = [candidate(0)];
  assert.throws(() => validateRequirementTaskPlan(duplicate, tasksMd, available(2)), FailError);
});
