/**
 * 全局环境类型声明。
 * Metro 在打包期会把 process.env.THS_API_KEY 之类的字面量替换为构建期注入的值。
 */
declare const process: {
  env: {
    [key: string]: string | undefined;
    THS_API_KEY?: string;
    NODE_ENV?: string;
  };
};
