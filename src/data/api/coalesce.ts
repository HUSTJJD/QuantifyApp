/**
 * coalesce.ts —— 并发同形请求合并（Inflight Coalescer）。
 *
 * 背景（P1 架构收敛）：
 *  App 内多个高频轮询方各自独立发请求——QuoteFeed 5s 轮询、useQuotes 15s 轮询、
 *  自选盯盘 15s 轮询、个股详情页等。同一时刻「同方法 + 同参数」的并发请求会同时
 *  打到上游，QPS 被按订阅方数量成倍放大，极易触发限频（4001）。
 *
 * 方案：并发的同键调用共享同一个在途 Promise（coalescing）：
 *  - 只去重「并发」：键相同的请求若先后串行执行，则各自独立发请求
 *    （settle 后即从注册表移除），绝不返回旧数据；
 *  - 键 = 方法名 + 稳定序列化后的参数（stableStringify 深排 key，同形参数同键）；
 *  - settle（成功或失败）后自清理：仅在注册表里仍是本 Promise 时才删除，
 *    避免误删稍后注册的新请求条目。
 *
 * 消费方：SourceRouter.invoke / partition（可通过 RouterOptions.coalesce 关闭，测试可禁用）。
 */

/**
 * 稳定序列化：对象 key 深度排序、数组保序，保证「同形」值产出相同字符串。
 * 仅处理 JSON 可表达的值（本仓请求参数均为该形态）；其余类型退化为空。
 */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? String(value) : 'null';
    case 'boolean':
      return String(value);
    case 'undefined':
      return 'null';
    default:
      break;
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** 在途请求注册表：同键并发共享同一次底层请求 */
export class InflightCoalescer {
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * 以 key 执行任务：若已有同键在途任务，直接共享其 Promise（含失败语义）；
   * 否则执行 task 并登记，settle 后自清理。
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    let p: Promise<T>;
    try {
      p = task().finally(() => {
        // 自清理：仅当注册表里仍是本 Promise 才删（防误删稍后注册的新请求）
        if (this.inflight.get(key) === p) this.inflight.delete(key);
      });
    } catch (e) {
      // task 同步抛错（正常不会：分发边界已预检）——不登记，直接拒绝
      return Promise.reject(e);
    }
    this.inflight.set(key, p);
    return p;
  }

  /** 当前在途键数量（可观测 / 测试断言用） */
  get size(): number {
    return this.inflight.size;
  }

  /** 清空全部在途条目（测试 / 释放用） */
  clear(): void {
    this.inflight.clear();
  }
}
