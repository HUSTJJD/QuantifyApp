/**
 * DEV 诊断：为未处理的 Promise rejection 打印完整堆栈。
 *
 * 背景：RN 默认只把 rejection 的 message 报给 LogBox（如 "undefined is not a
 * function"），不含堆栈，无法定位来源。这里拦截两个点（双保险）：
 *  1) promiseRejectionTrackingOptions.onUnhandled —— Hermes 原生 tracker 若在
 *     rejection 时动态读取该属性则生效（拿到原始 rejection 对象）；
 *  2) ExceptionsManager.handleException —— RN 的 onUnhandled 最终必经此处，
 *     wrapper Error 的 `cause` 即原始 rejection（含完整 stack），此处必生效。
 *
 * 仅 __DEV__ 生效；生产构建零开销（模块体整体被 DCE）。
 */

if (__DEV__) {
  try {
    // 1) 替换 rejection-tracking 回调（若原生侧动态读取属性则生效）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const prto = require('react-native/Libraries/promiseRejectionTrackingOptions').default as {
      onUnhandled?: (id: number, rejection: unknown) => void;
    };
    const originalOnUnhandled = prto.onUnhandled;
    prto.onUnhandled = (id: number, rejection: unknown) => {
      if (rejection instanceof Error) {
        console.error(`[UnhandledRejection id:${id}] ${rejection.message}\n${rejection.stack ?? '(no stack)'}`);
      } else {
        console.error(`[UnhandledRejection id:${id}]`, rejection);
      }
      originalOnUnhandled?.(id, rejection);
    };
  } catch {
    // 诊断失败不影响 App 运行
  }

  try {
    // 2) 拦截 ExceptionsManager.handleException：unhandled rejection 的 wrapper
    //    Error 带 cause（= 原始 rejection），把 cause 的堆栈打出来
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const em = require('react-native/Libraries/Core/ExceptionsManager').default as {
      handleException?: (e: Error, isFatal: boolean) => void;
    };
    const originalHandle = em.handleException;
    if (originalHandle) {
      em.handleException = (e: Error, isFatal: boolean) => {
        const cause = (e as { cause?: unknown }).cause;
        if (typeof e?.message === 'string' && e.message.includes('Uncaught (in promise') && cause instanceof Error) {
          console.error(
            `[UnhandledRejection cause] ${cause.message}\n${cause.stack ?? '(no stack)'}`,
          );
        }
        originalHandle.call(em, e, isFatal);
      };
    }
  } catch {
    // 诊断失败不影响 App 运行
  }
}
