/**
 * tfs/usage.ts —— TFS API 命令的用法文本(承自 tfs-cli,index.ts USAGE,命令前缀换为 rondo)。
 * 仅走 stderr(用法错误场景),保持 stdout 纯净。
 */

import { DEFAULT_COLLECTION } from "./config.js";

export const TFS_API_USAGE = `TFS API 命令用法

配置(环境变量优先,config/tfs.config.json 兜底):
  TFS_PAT           个人访问令牌(必需;禁止走命令行参数)
  TFS_URL           TFS base URL(不含 collection)
  TFS_SERVER_URL    完整 collection URL(优先于 TFS_URL)
  TFS_COLLECTION    集合名(默认 ${DEFAULT_COLLECTION})
  TFS_PROJECT       默认团队项目(可被 --project 覆盖)

命令:
  rondo query --wiql "<WIQL>" [--project <p>]
  rondo repo get --name <repo> [--project <p>]
  rondo branch get --repo <name|id> --name <branch> [--project <p>]
  rondo pr create --repo <name|id> --source <branch> --target <branch> --title <t>
            [--description-file <f>] [--work-items <id,id>] [--project <p>]
  rondo pr get --repo <name|id> --id <n> [--project <p>]
  rondo pr list --repo <name|id> [--status active|completed|abandoned] [--source-branch <b>] [--top <n>] [--project <p>]
  rondo workitem set-state --id <n> --state <s> [--complete-with-estimate] [--project <p>]
          (--complete-with-estimate:置态同时确定性落库 CompletedWork=OriginalEstimate、
           RemainingWork=0;已是目标态仍核对补齐;
           跨态自动按类型有序链逐跳中转:任务/Bug 已建议→活动→已解决,需求 已建议→活动→已分析→已解决)
  rondo workitem comment --id <n> --text-file <f> [--project <p>]
  rondo workitem link-commits --id <n> --repo <name|id> --sha <sha,sha,...> [--project <p>]
          (把 commit 以 Artifact Link 挂到工作项;幂等,已链接跳过;failed 非空 → exit 2)
  rondo workitem create --type <类型> --title <t> --parent <父id>
            [--description-file <f>] [--estimate <小时>] [--project <p>]
  rondo workitem download-attachment --url <附件url> --out <目录> [--name <文件名>]
          (gzip 存储自动按 magic 解压;同名覆盖幂等)
`;
