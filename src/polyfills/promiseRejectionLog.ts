/**
 * DEV 诊断：为未处理的 Promise rejection 打印完整堆栈。
 *
 * 背景：RN 默认只把 rejection 的 message 报给 LogBox（如 "undefined is not a
 * function"），不含堆栈，无法定位来源。
 *
 * 用全局 ErrorUtils（RN 启动时注入）拦截，避免 deep import
 * `react-native/Libraries/...`（RN 0.87+ 会 warn deprecated）。
 * 仅 __DEV__ 生效；生产构建零开销。
 */

if (__DEV__) {
  try {
    const errorUtils = (globalThis as { ErrorUtils?: {
      reportFatalError?: (e: Error) => void;
    } }).ErrorUtils;
    if (errorUtils?.reportFatalError) {
      const original = errorUtils.reportFatalError.bind(errorUtils);
      errorUtils.reportFatalError = (e: Error) => {
        const cause = (e as { cause?: unknown }).cause;
        if (
          typeof e?.message === 'string' &&
          e.message.includes('Uncaught (in promise') &&
          cause instanceof Error
        ) {
          console.error(
            `[UnhandledRejection cause] ${cause.message}\n${cause.stack ?? '(no stack)'}`,
          );
        } else if (e instanceof Error) {
          // 普通致命错误也打一层，便于对齐 LogBox 源
          // （不替换 LogBox，只补充日志）
        }
        original(e);
      };
    }
  } catch {
    // 诊断失败不影响 App 运行
  }
}
