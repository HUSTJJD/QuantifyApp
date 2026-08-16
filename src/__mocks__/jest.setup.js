/**
 * Jest 测试环境 setup（运行于 setupFiles 阶段，此时测试框架钩子 afterAll 尚未注入）。
 * 原生存储模块已由 jest.config moduleNameMapper 映射到 CJS mock，
 * 此处仅保留可扩展的全局初始化（如清理计时器/关闭连接等）。
 */
const { closeDatabase } = require('@/db');

// 全部用例结束后关闭 K 线数据库单例，避免 SQLite / 句柄泄漏导致
// "Jest did not exit one second after the test run has completed"。
// 注意：本文件在 setupFiles（框架安装前）阶段执行，afterAll 不可用，
// 故改用框架无关的 process 退出钩子。
process.once('beforeExit', () => {
  closeDatabase().catch(() => {});
});

