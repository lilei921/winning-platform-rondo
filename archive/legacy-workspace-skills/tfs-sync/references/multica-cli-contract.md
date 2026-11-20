# Multica CLI Contract

`tfs-sync` 依赖以下 CLI 能力。

## Read

```text
multica issue list --metadata --limit --full-id --output json
multica issue get <id> --output json
multica issue search <query> --include-closed --output json
multica project list --output json
multica squad list --output json
```

`issue search` 只用于创建过程写入结果未知时的保守恢复，不作为长期身份查询。

## Create

```text
multica issue create
  --title
  --description-file
  --status backlog
  --priority
  --project
  --output json
```

创建后使用精确 Squad ID：

```text
multica issue assign <issue-id> --to-id <SQUAD_ID> --no-start
```

不得自动启动 Run。

## Update

```text
multica issue update <id>
  --title
  --description-file
  --priority
  --no-start
```

已有 Delivery Issue 的同步更新不得修改 status 或 assignee。

## Metadata

```text
multica issue metadata set <id>
  --key
  --value
  --type string
```

使用 primitive KV。`tfs.id` 强制以 string 传递。

## Resolution

Project 与 Delivery Squad 必须按 ID 或精确名称唯一解析。名称存在歧义时直接失败。

## Preflight

`sync-run.py` 每批次只执行一次 CLI capability preflight。缺少必要命令或 flag 时，在任何写入前返回：

```text
CLI_CAPABILITY_MISSING
```
