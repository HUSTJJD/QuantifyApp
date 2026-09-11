module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
     [
        'module-resolver',
        {
        root: ['./src'],
        alias: {
           '@': './src',
           '@/api': './src/data/api',
           '@/db': './src/data/db',
           '@/cache': './src/data/cache',
           '@/sync': './src/data/sync',
           '@/repositories': './src/data/repositories',
          },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
      // 打包时将 process.env.THS_API_KEY 等内联为字符串字面量，
      // 使构建期注入的环境变量（测试 Key）能在 RN 运行时读取。
     [
        'transform-inline-environment-variables',
        {
        include: ['THS_API_KEY', 'NODE_ENV'],
        },
      ],
      // WatermelonDB 模型使用 legacy 装饰器语法（Babel 7 用 legacy:true，而非 Babel 8 的 version:'legacy'）。
      ['@babel/plugin-proposal-decorators', { legacy: true }],
    ],
};
