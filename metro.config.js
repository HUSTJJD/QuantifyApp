const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const path = require('path');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const projectRoot = __dirname;
const srcRoot = path.resolve(projectRoot, 'src');

const config = {
  resolver: {
    // 把 @/xxx 重写为绝对路径 <root>/src/xxx，使 Metro 能解析别名
    resolveRequest: (context, moduleName, platform, moduleCache) => {
      if (moduleName.startsWith('@/')) {
        const rest = moduleName.slice('@/'.length);
        const candidate = path.resolve(srcRoot, rest);
        return context.resolveRequest(
          context,
          candidate,
          platform,
          moduleCache,
        );
      }
      // react-native-paper 内部硬编码了 @expo/vector-icons 与
      // @react-native-vector-icons/material-design-icons 作为图标 fallback。
      // 裸 RN 项目里前者会拉进整条 expo 依赖链（expo-font/expo-asset/...），
      // 后者依赖 RN 已废弃的 @react-native/assets-registry，均会导致 Metro 解析失败。
      // 这里把两者统一重定向到已安装的单体包 react-native-vector-icons
      // （RN 0.87 兼容、无上述依赖问题），使 paper 正常渲染 Material 图标且零额外依赖。
      if (moduleName.startsWith('@expo/vector-icons/')) {
        const rest = moduleName.slice('@expo/vector-icons/'.length);
        return context.resolveRequest(
          context,
          `react-native-vector-icons/${rest}`,
          platform,
          moduleCache,
        );
      }
      if (moduleName === '@react-native-vector-icons/material-design-icons') {
        return context.resolveRequest(
          context,
          'react-native-vector-icons/MaterialCommunityIcons',
          platform,
          moduleCache,
        );
      }
      return context.resolveRequest(context, moduleName, platform, moduleCache);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
