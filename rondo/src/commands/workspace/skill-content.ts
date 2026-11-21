import { readFileSync } from "node:fs";
import { UnknownError } from "../../cli/errors.js";

/** 统一检出后的文本字节，供 Skill 上传和哈希校验共用。 */
export function readSkillContent(path: string): string {
  const bytes = readFileSync(path);
  try {
    // TextDecoder 默认移除 UTF-8 BOM，fatal 防止非法字节被替换后上传。
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/\r\n/g, "\n");
  } catch {
    throw new UnknownError(`Skill 文件必须使用 UTF-8 编码: ${path}`);
  }
}
