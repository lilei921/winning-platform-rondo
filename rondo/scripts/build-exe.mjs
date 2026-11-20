/**
 * scripts/build-exe.mjs — rondo 原生 exe 构建管线(承自 tfs-cli,方案:projects/plans/rondo-cli-merge-plan.md §6)
 *
 * 步骤:esbuild 单文件 CJS bundle(注入版本号)→ node --experimental-sea-config 生成 blob
 *       → 复制当前 node 底座 → postject 注入 → 生成 sidecar package.json
 *       (azure-devops-node-api 运行时按 __dirname 读自身版本组 User-Agent,exe 旁必须携带)。
 *
 * 用法:npm run build:exe           产物:dist-exe/rondo[.exe] + dist-exe/package.json
 * 平台:在哪个平台运行就产出哪个平台的可执行文件(底座 = 当前 process.execPath)。
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const exeName = isWin ? 'rondo.exe' : 'rondo';

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf-8'));
const adoApiVersion = require('azure-devops-node-api/package.json').version;

console.log(`[1/5] esbuild bundle (version=${pkg.version})`);
const esbuild = require('esbuild');
await esbuild.build({
  entryPoints: [path.join(root, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: { __RONDO_VERSION__: JSON.stringify(pkg.version) },
  outfile: path.join(root, 'build/sea/bundle.cjs'),
  logLevel: 'warning',
});

console.log('[2/5] SEA blob');
execFileSync(process.execPath, ['--experimental-sea-config', 'sea/sea-config.json'], { cwd: root, stdio: 'inherit' });

console.log('[3/5] 复制 node 底座');
mkdirSync(path.join(root, 'dist-exe'), { recursive: true });
const exePath = path.join(root, 'dist-exe', exeName);
copyFileSync(process.execPath, exePath);

console.log('[4/5] postject 注入');
const binary = readFileSync(exePath, 'latin1');
const fuse = binary.match(/NODE_SEA_FUSE_[a-f0-9]{32}/)?.[0];
if (!fuse) throw new Error('node 底座中未找到 NODE_SEA_FUSE sentinel(Node 版本不受支持?)');
const { inject } = require('postject');
await inject(exePath, 'NODE_SEA_BLOB', readFileSync(path.join(root, 'build/sea/sea-prep.blob')), { sentinelFuse: fuse });

console.log('[5/5] sidecar package.json');
writeFileSync(
  path.join(root, 'dist-exe', 'package.json'),
  JSON.stringify({ name: 'azure-devops-node-api', version: adoApiVersion }) + '\n',
);

console.log(`OK: ${exePath}`);
console.log(`    sidecar: dist-exe/package.json (azure-devops-node-api ${adoApiVersion})`);
console.log(`    内嵌 Node: ${process.version}`);
