// 在 npm pack 前把仓库根的 OpenSpec Schema 同步进包内；仓库根 openspec/schemas 是唯一来源。
import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("..", "openspec", "schemas");
const target = resolve("openspec", "schemas");
rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log(`已复制 OpenSpec Schema：${source} -> ${target}`);
