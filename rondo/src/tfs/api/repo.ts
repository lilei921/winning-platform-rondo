/**
 * repo get --repo <name|id> [--project <p>]
 * repo get-branch --repo <name|id> --branch <branch> [--project <p>]
 * 输出契约：{ "found": true|false, ... }；found:false → 由调用层判 exit 2（明确失败，非 UNKNOWN）
 */

import { TfsClient, FailError } from '../client.js';
import { withTransientRetry } from '../retry.js';

export async function resolveRepo(client: TfsClient, nameOrId: string, project?: string): Promise<any | null> {
  const proj = project || client.config.project;
  try {
    // 先按 ID/名称直接取（SDK getRepository 同时接受 id 和 name）
    // M3.3：SDK 读包瞬态重试；重试前 rebuildTransport（缓存的 gitApi 随旧连接一起作废）
    return await withTransientRetry(
      async () => (await client.getGitApi()).getRepository(nameOrId, proj),
      { onBeforeRetry: () => client.rebuildTransport(), what: `读取仓库 ${nameOrId}` },
    );
  } catch {
    // 回退：列仓库按名称匹配（大小写不敏感）
    const repos: any[] = await withTransientRetry(
      async () => (await client.getGitApi()).getRepositories(proj),
      { onBeforeRetry: () => client.rebuildTransport(), what: '列出仓库' },
    );
    return repos.find((r) => String(r.name).toLowerCase() === nameOrId.toLowerCase()) || null;
  }
}

export async function cmdRepoGet(opts: { name: string; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const repo = await resolveRepo(client, opts.name, opts.project);
  if (!repo) throw new FailError(JSON.stringify({ found: false, name: opts.name }));
  return {
    found: true,
    repo: {
      id: repo.id,
      name: repo.name,
      project: repo.project?.name || opts.project || client.config.project || null,
      defaultBranch: repo.defaultBranch || null,
    },
  };
}

export async function cmdBranchGet(opts: { repo: string; name: string; project?: string }): Promise<unknown> {
  const client = new TfsClient();
  const repo = await resolveRepo(client, opts.repo, opts.project);
  if (!repo) throw new FailError(JSON.stringify({ found: false, repo: opts.repo, reason: 'repo_not_found' }));

  const proj = opts.project || client.config.project;
  const branches: any[] = await withTransientRetry(
    async () => (await client.getGitApi()).getBranches(repo.id, proj, undefined, undefined, undefined, undefined, opts.name),
    { onBeforeRetry: () => client.rebuildTransport(), what: `读取分支 ${opts.name}` },
  );
  // SDK 的 filter 是模糊匹配（contains），必须精确匹配 name；严禁回退 branches[0]（曾误报 found:true）
  const branch = branches?.find((b: any) => b.name === opts.name);
  if (!branch) throw new FailError(JSON.stringify({ found: false, repo: repo.name, branch: opts.name }));

  return {
    found: true,
    branch: { name: branch.name, commit: branch.commit?.commitId || null },
  };
}
