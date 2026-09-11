// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const srcRoot = path.resolve(projectRoot, 'src');
// zrender 嵌套的旧版 tslib ESM 在 Metro 下 default 互操作会炸，强制走根包 CJS
const tslibCjs = path.resolve(projectRoot, 'node_modules/tslib/tslib.js');

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
  // tslib 统一 CJS
  if (
    moduleName === 'tslib' ||
    moduleName === 'tslib/tslib.js' ||
    moduleName.endsWith('/tslib') ||
    moduleName.endsWith('\\tslib')
  ) {
    return { type: 'sourceFile', filePath: tslibCjs };
  }
  // haptic 原生未链接时的 JS 垫片
  if (moduleName === 'react-native-haptic-feedback') {
    return {
      type: 'sourceFile',
      filePath: path.resolve(projectRoot, 'src/polyfills/RNHapticFeedbackStub.js'),
    };
  }
  // 交给 Expo 默认解析器
  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform, moduleCache);
  }
  return context.resolveRequest(context, moduleName, platform, moduleCache);
};

module.exports = config;
