// 仅在 TT-6 验收子进程边界注入故障，所有外部读写仍由真实客户端完成。
import { MulticaClient } from '../../../../../tools/rondo/dist/clients/multica.js';
import { UnknownError } from '../../../../../tools/rondo/dist/cli/errors.js';
const original = MulticaClient.prototype.setMetadata;
let fired = false;
MulticaClient.prototype.setMetadata = function(id, key, value) {
  if (id === '01a1d943-7e6e-7cb1-bd26-7957ae333b5e' && !fired) {
    const mode = process.env.RONDO_08A_FAULT;
    if (key === 'delivery.tfs_written' && mode === 'crash-after-comment') process.exit(86);
    if (key === 'delivery.tfs_written' && mode === 'marker-save-fails' ||
        key === 'delivery.summary_comment_id' && mode === 'summary-id-fails') {
      fired = true;
      throw new UnknownError(`08A_INJECTED_${mode}`);
    }
  }
  return original.call(this, id, key, value);
};
