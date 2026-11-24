import { FailError } from "../../cli/errors.js";

/** The remote Candidate Branch is shared by Bug and Requirement. */
export function candidateBranch(tfsId: number | string): string {
  const id = Number(tfsId);
  if ((typeof tfsId === "string" && !/^\d+$/.test(tfsId)) || !Number.isSafeInteger(id) || id <= 0) {
    throw new FailError("TFS ID 无效，无法确定 Candidate Branch");
  }
  return "feature/" + id;
}
