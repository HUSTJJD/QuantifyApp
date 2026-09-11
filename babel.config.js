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
            // 业务代码里 @/assets/icons = src/assets/icons；
            // 根目录 assets/ 仅存放 Expo 图标/启动图，用相对路径引用即可。
            '@': './src',
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
