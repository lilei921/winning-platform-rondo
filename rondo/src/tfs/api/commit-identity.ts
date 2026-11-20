/** TFS 2018 Commit ArtifactLink identity: Project GUID + Repository GUID + SHA. */
export interface CommitIdentity { projectId: string; repoId: string; sha: string }

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shaPattern = /^[0-9a-f]{7,40}$/i;

export function commitKey(identity: CommitIdentity): string {
  return [identity.projectId, identity.repoId, identity.sha].map(v => v.toLowerCase()).join("/");
}

/** null = not a Git Commit link; malformed Git Commit links must not be ignored by the KPI gate. */
export function parseCommitArtifact(url: string): CommitIdentity | null {
  if (!url.toLowerCase().startsWith("vstfs:///git/commit/")) return null;
  const parts = url.slice("vstfs:///Git/Commit/".length).split(/%2f/i);
  if (parts.length !== 3 || !guid.test(parts[0]) || !guid.test(parts[1]) || !shaPattern.test(parts[2])) {
    throw new Error("TFS Commit ArtifactLink 身份格式不可信: " + url);
  }
  return { projectId: parts[0].toLowerCase(), repoId: parts[1].toLowerCase(), sha: parts[2].toLowerCase() };
}

export function commitArtifactUrl(identity: CommitIdentity): string {
  return `vstfs:///Git/Commit/${identity.projectId}%2F${identity.repoId}%2F${identity.sha}`;
}
