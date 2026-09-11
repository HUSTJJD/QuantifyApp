const path = require('path');

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./src'],
          alias: {
            // 业务代码里 @/theme/icons = src/theme/icons；
            // 根目录 assets/ 仅存放 Expo 图标/启动图，用相对路径引用即可。
            '@': './src',
            // 同花顺/扶摇（fuyao）官方 SDK：统一指向本地 FuyaoNPM 源码，
            // 不再依赖发布的 npm 包（包名 @opptrix/fuyao 保持不变）。
            '@opptrix/fuyao': path.resolve(__dirname, 'FuyaoNPM/src/index.ts'),
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      [
        'transform-inline-environment-variables',
        { include: ['THS_API_KEY', 'NODE_ENV'] },
      ],
      ['@babel/plugin-proposal-decorators', { legacy: true }],
      // reanimated/worklets 插件必须最后
      'react-native-reanimated/plugin',
    ],
  };
};
