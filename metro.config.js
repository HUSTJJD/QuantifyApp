// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const srcRoot = path.resolve(projectRoot, 'src');
// zrender 嵌套的旧版 tslib ESM 在 Metro 下 default 互操作会炸，强制走根包 CJS
const tslibCjs = path.resolve(projectRoot, 'node_modules/tslib/tslib.js');
// 同花顺/扶摇（fuyao）官方 SDK：统一指向本地 FuyaoNPM 源码，
// 与 babel module-resolver 别名保持一致（metro 解析器不参与 babel 别名重写）。
const fuyaoLocal = path.resolve(projectRoot, 'FuyaoNPM/src/index.ts');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform, moduleCache) => {
  // @/xxx → <root>/src/xxx（业务代码统一约定）
  if (moduleName.startsWith('@/')) {
    const rest = moduleName.slice('@/'.length);
    return context.resolveRequest(
      context,
      path.resolve(srcRoot, rest),
      platform,
      moduleCache,
    );
  }
  // @opptrix/fuyao → 本地 FuyaoNPM 源码（统一使用本地实现，不依赖发布 npm 包）
  if (moduleName === '@opptrix/fuyao') {
    return { type: 'sourceFile', filePath: fuyaoLocal };
  }
  // tslib 统一 CJS
  if (
    moduleName === 'tslib' ||
    moduleName === 'tslib/tslib.js' ||
    moduleName.endsWith('/tslib') ||
    moduleName.endsWith('\\tslib')
  ) {
    return { type: 'sourceFile', filePath: tslibCjs };
  }
  // 交给 Expo 默认解析器
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform, moduleCache);
  }
  return context.resolveRequest(context, moduleName, platform, moduleCache);
};

module.exports = config;
