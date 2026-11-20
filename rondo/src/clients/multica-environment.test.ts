import test from "node:test";
import assert from "node:assert/strict";
import { bindEnvironment, multicaPrefix } from "./multica-environment.js";

test("工作区环境绑定、继承与跨环境拒绝", () => {
  const env = bindEnvironment({}, "private", () => "https://multica.example/");
  assert.deepEqual(multicaPrefix({ multica_cli: "multica", ...env }), ["multica", "--profile", "private", "--server-url", "https://multica.example"]);
  assert.deepEqual(bindEnvironment(env, undefined, () => "https://multica.example"), env);
  assert.throws(() => bindEnvironment(env, "cloud", () => "https://cloud.example"), /profile/);
  assert.throws(() => bindEnvironment(env, undefined, () => "https://other.example"), /server_url/);
  assert.throws(() => bindEnvironment({}, true, () => "https://example.com"), /profile/);
  assert.throws(() => bindEnvironment({}, "p&echo", () => "https://example.com"), /profile/);
});

test("绑定默认环境后不再读取进程 profile，未绑定配置仍支持环境变量", () => {
  const previous = process.env.RONDO_MULTICA_PROFILE;
  process.env.RONDO_MULTICA_PROFILE = "other";
  try {
    const env = { multica_server_url: "https://default.example" };
    assert.deepEqual(multicaPrefix({ multica_cli: "multica", ...env }), ["multica", "--server-url", env.multica_server_url]);
    assert.deepEqual(bindEnvironment(env, undefined, prefix => {
      assert.deepEqual(prefix, ["multica"]);
      return env.multica_server_url;
    }), env);
    assert.deepEqual(multicaPrefix({ multica_cli: "multica" }), ["multica", "--profile", "other"]);
    assert.throws(() => bindEnvironment(env, "other", () => "https://default.example"), /profile/);
  } finally {
    if (previous === undefined) delete process.env.RONDO_MULTICA_PROFILE;
    else process.env.RONDO_MULTICA_PROFILE = previous;
  }
});
