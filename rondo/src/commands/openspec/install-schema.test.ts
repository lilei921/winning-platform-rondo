/**
 * openspec install-schema 回归：只使用临时目录，不写真实的全局 Schema 目录。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { globalSchemasDir, installSchemas } from "./install-schema.js";

function makeSchema(root: string, name: string, body: string): void {
  const templates = path.join(root, name, "templates");
  mkdirSync(templates, { recursive: true });
  writeFileSync(path.join(root, name, "schema.yaml"), body, "utf8");
  writeFileSync(path.join(templates, "proposal.md"), body, "utf8");
}

test("installSchemas 覆盖同名 Schema 并保留其他目录", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rondo-schema-"));
  try {
    const source = path.join(base, "source");
    const target = path.join(base, "target");
    makeSchema(source, "corrective-change", "new");
    makeSchema(source, "intentional-change", "new");
    makeSchema(target, "corrective-change", "old");
    makeSchema(target, "other-schema", "keep");

    assert.deepEqual(installSchemas(source, target), ["corrective-change", "intentional-change"]);
    assert.equal(readFileSync(path.join(target, "corrective-change", "schema.yaml"), "utf8"), "new");
    assert.equal(readFileSync(path.join(target, "intentional-change", "schema.yaml"), "utf8"), "new");
    assert.equal(readFileSync(path.join(target, "other-schema", "schema.yaml"), "utf8"), "keep");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("installSchemas 遇到空源目录报错", () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "rondo-schema-"));
  try {
    assert.throws(() => installSchemas(base, path.join(base, "target")), /没有可用的 Schema/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("globalSchemasDir 对齐 OpenSpec 全局目录规则", () => {
  assert.equal(globalSchemasDir({ XDG_DATA_HOME: "/tmp/xdg" }, "linux"), path.join("/tmp/xdg", "openspec", "schemas"));
  assert.equal(globalSchemasDir({ LOCALAPPDATA: "C:\\appdata" }, "win32"), path.join("C:\\appdata", "openspec", "schemas"));
});
