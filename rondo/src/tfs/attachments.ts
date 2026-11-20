/** TFS 附件只以 collection + GUID 标识；跨项目批量查询的 HTML 项目路径可能错位。 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTACHMENT_PATH_RE = /^(.*?)\/_apis\/wit\/attachments(?:\/([^/]+))?\/?$/i;

interface AttachmentUrl {
  source: URL;
  scope: string;
  guid: string;
  fileName: string | null;
}

/** URLSearchParams 名称本来区分大小写，TFS 历史 HTML 中的 FileNameGUID/FileName 并不统一。 */
function queryValue(url: URL, name: string): string | null {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name.toLowerCase()) return value;
  return null;
}

function parseAttachmentUrl(sourceUrl: string): AttachmentUrl | null {
  try {
    const source = new URL(sourceUrl.replace(/&amp;/gi, '&'));
    if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return null;
    const matched = source.pathname.match(ATTACHMENT_PATH_RE);
    if (!matched) return null;
    const pathGuid = matched[2];
    const queryGuid = queryValue(source, 'FileNameGUID');
    const guid = pathGuid ?? queryGuid;
    if (!guid || !GUID_RE.test(guid)) return null;
    // 两种 GUID 同时存在而冲突时，不能猜测附件身份。
    if (pathGuid && queryGuid && pathGuid.toLowerCase() !== queryGuid.toLowerCase()) return null;
    return { source, scope: matched[1], guid: guid.toLowerCase(), fileName: queryValue(source, 'fileName') };
  } catch {
    return null;
  }
}

/** 仅在已知 TFS/Azure URL 结构中去掉项目段；未知路径不猜 collection，避免误合并。 */
function collectionScope(attachment: AttachmentUrl): string {
  const tfs = attachment.scope.match(/^(.*\/tfs\/[^/]+)(?:\/[^/]+)?$/i);
  if (tfs) return tfs[1];
  if (attachment.source.hostname.toLowerCase() === 'dev.azure.com') {
    const azure = attachment.scope.match(/^(\/[^/]+)(?:\/[^/]+)?$/);
    if (azure) return azure[1];
  }
  return attachment.scope;
}

/** 旧正文仍保留 source URL；比较映射时使用此稳定身份，不因项目路径或文件名变化重传。 */
export function attachmentIdentity(sourceUrl: string): string {
  const attachment = parseAttachmentUrl(sourceUrl);
  if (!attachment) return sourceUrl;
  return `${attachment.source.origin}${collectionScope(attachment).toLowerCase()}/_apis/wit/attachments/${attachment.guid}`;
}

/**
 * 下载地址以配置中的可信 collection 为准；只接受其自身或下一层 project 下的附件 URL。
 * 此校验发生在发送 PAT 之前，外站和其他 collection 不会收到凭据。
 */
export function normalizeAttachmentUrl(sourceUrl: string, collectionUrl: string): string {
  const attachment = parseAttachmentUrl(sourceUrl);
  let collection: URL;
  try { collection = new URL(collectionUrl); } catch { throw new Error('附件下载 collection URL 无效'); }
  if (!attachment || !['http:', 'https:'].includes(collection.protocol) || collection.username || collection.password) {
    throw new Error('附件 URL 无效或缺少有效 GUID');
  }
  const basePath = collection.pathname.replace(/\/+$/, '');
  const baseLower = basePath.toLowerCase();
  const sourceLower = attachment.scope.toLowerCase();
  const projectSuffix = sourceLower.startsWith(baseLower + '/') ? sourceLower.slice(baseLower.length + 1) : null;
  if (attachment.source.origin !== collection.origin ||
      (sourceLower !== baseLower && (!projectSuffix || projectSuffix.includes('/')))) {
    throw new Error('附件 URL 不属于配置的 TFS collection，拒绝发送凭据');
  }
  const download = new URL(`${collection.origin}${basePath}/_apis/wit/attachments/${attachment.guid}`);
  if (attachment.fileName !== null) download.searchParams.set('fileName', attachment.fileName);
  download.searchParams.set('download', 'true');
  download.searchParams.set('api-version', '4.1');
  return download.href;
}
