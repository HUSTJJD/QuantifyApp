#!/usr/bin/env node
/**
 * postinstall：确保 stock-sdk 子模块的 dist 产物存在（见 package.json "stock-sdk": "file:./stock-sdk"）。
 *
 * 背景：stock-sdk 是 git 子模块，其 package.json 的 main/exports 指向 dist/*，
 * 而 dist/ 在子模块内被 gitignore（构建产物不入库）。本地开发时 dist 由开发者
 * 手工构建；但 EAS Build / 新克隆等「干净环境」中 dist 不存在，Metro 解析
 * `main: dist/index.cjs` 失败 → `expo export:embed` / Android Bundling 直接挂掉。
 *
 * 本脚本在 npm install 之后运行（子模块被 file: 依赖以 symlink 形式挂进 node_modules，
 * 此处构建产物可被 Metro 直接看到）：
 *   - dist 已存在        → 快速跳过（本地开发的常态，零开销）
 *   - dist 缺失          → 在子模块内 npm install（若 node_modules 不完整）+ npm run build (tsup)
 *   - 子模块未检出/构建失败 → 明确报错退出，让安装阶段即暴露问题（而不是拖到打包阶段）
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const sdkDir = path.join(__dirname, '..', 'stock-sdk');
const distMain = path.join(sdkDir, 'dist', 'index.cjs');

function run(cmd) {
  execSync(cmd, { cwd: sdkDir, stdio: 'inherit' });
}

if (!fs.existsSync(path.join(sdkDir, 'package.json'))) {
  // file: 依赖在 npm install 阶段就该已失败；这里宽容跳过，仅提示。
  console.warn(
    '[build-stock-sdk] stock-sdk/ 缺少 package.json（子模块未检出？请先 git submodule update --init --recursive），跳过构建'
  );
  process.exit(0);
}

if (fs.existsSync(distMain)) {
  console.log('[build-stock-sdk] stock-sdk dist 已存在，跳过构建');
  process.exit(0);
}

console.log('[build-stock-sdk] stock-sdk dist 缺失，开始构建（首次安装/EAS 构建需要，约 1-3 分钟）…');

if (!fs.existsSync(path.join(sdkDir, 'node_modules', '.bin', 'tsup'))) {
  console.log('[build-stock-sdk] stock-sdk 依赖未安装，执行 npm install …');
  run('npm install --no-audit --no-fund');
}

run('npm run build');

if (!fs.existsSync(distMain)) {
  console.error('[build-stock-sdk] 构建完成但未找到 dist/index.cjs，请检查 stock-sdk 构建日志');
  process.exit(1);
}

console.log('[build-stock-sdk] stock-sdk 构建完成');
