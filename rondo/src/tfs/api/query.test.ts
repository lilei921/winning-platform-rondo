/**
 * query.ts 纯函数单测（M3.3）：workItemsUrl 形状 + WORKITEM_BATCH。
 * 迁移正确性（SDK → rawRequest GET）依赖 test220 实环境人工比对（无活 TFS 的补偿，见计划 §验证）。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { workItemsUrl, WORKITEM_BATCH, cmdQuery } from "./query.js";
import { TfsClient, UnknownError } from "../client.js";

test("workItemsUrl：ids 逗号连接 + $expand=all + api-version=4.1", () => {
  assert.equal(
    workItemsUrl("http://tfs.example.com/tfs/DefaultCollection", [1, 22, 333]),
    "http://tfs.example.com/tfs/DefaultCollection/_apis/wit/workitems?ids=1,22,333&$expand=all&api-version=4.1",
  );
});

test("workItemsUrl：空数组与单元素边界", () => {
  assert.equal(
    workItemsUrl("http://tfs/x", []),
    "http://tfs/x/_apis/wit/workitems?ids=&$expand=all&api-version=4.1",
  );
  assert.equal(
    workItemsUrl("http://tfs/x", [7]),
    "http://tfs/x/_apis/wit/workitems?ids=7&$expand=all&api-version=4.1",
  );
});

test("WORKITEM_BATCH = 50（raw GET URL 长度与单批体量的稳妥值）", () => {
  assert.equal(WORKITEM_BATCH, 50);
});

test("无 relations 的 TFS Work Item 可读取；非法 relations 返回 UNKNOWN", async t => {
  const keys = ["TFS_PAT", "TFS_SERVER_URL", "TFS_PROJECT"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, {
    TFS_PAT: "fixture", TFS_SERVER_URL: "http://tfs.test/tfs/C", TFS_PROJECT: "Hospital",
  });
  t.after(() => { for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  } });
  t.mock.method(TfsClient.prototype, "getWitApi", async () => ({
    queryByWiql: async () => ({ workItems: [{ id: 42 }] }),
  }));
  let relations: unknown = undefined;
  t.mock.method(TfsClient.prototype, "rawRequest", async () => ({
    statusCode: 200, body: JSON.stringify({ value: [{ id: 42,
      fields: { "System.WorkItemType": "需求", "System.Title": "Requirement" },
      ...(relations === undefined ? {} : {relations}),
    }] }),
  }));
  const result = await cmdQuery({ wiql: "SELECT [System.Id] FROM WorkItems", project: "Hospital" }) as any[];
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].artifactLinks, []);
  assert.deepEqual(result[0].childIds, []);
  assert.deepEqual(result[0].attachments, []);
  relations = { invalid: true };
  await assert.rejects(cmdQuery({ wiql: "SELECT [System.Id] FROM WorkItems", project: "Hospital" }), UnknownError);
});
