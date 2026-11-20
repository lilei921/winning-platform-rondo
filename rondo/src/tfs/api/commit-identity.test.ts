import test from "node:test";
import assert from "node:assert/strict";
import { commitArtifactUrl, commitKey, parseCommitArtifact } from "./commit-identity.js";

const one = {projectId:"11111111-1111-1111-1111-111111111111",
  repoId:"22222222-2222-2222-2222-222222222222",sha:"a".repeat(40)};
test("Git ArtifactLink 用完整 Project GUID/Repo GUID/SHA 身份，不仅按 SHA", () => {
  const parsed = parseCommitArtifact(commitArtifactUrl(one));
  assert.deepEqual(parsed,one);
  assert.equal(commitKey(parsed!),commitKey(one));
  assert.notEqual(commitKey({...one,repoId:"33333333-3333-3333-3333-333333333333"}),commitKey(one));
  assert.notEqual(commitKey({...one,projectId:"44444444-4444-4444-4444-444444444444"}),commitKey(one));
  assert.notEqual(commitKey({...one,sha:"b".repeat(40)}),commitKey(one));
  assert.equal(parseCommitArtifact("vstfs:///Git/PullRequestId/a%2Fb%2F123"),null);
  assert.throws(()=>parseCommitArtifact("vstfs:///Git/Commit/wrong%2F2222%2Fa"));
});
