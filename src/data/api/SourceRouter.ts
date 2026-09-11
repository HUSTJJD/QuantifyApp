/**
 * SourceRouter —— 行情源统一调度器。
 *
 * 这是行情模块的「大脑」：所有数据请求都经过这里，它负责：
 *  1. 能力发现：根据各源的 capabilities + supports() 自动筛选可用源
 *  2. 稳定优先调度：有运行统计时按各源综合稳定分（成功率+覆盖度）降序尝试，
 *     优先打最稳的源；冷启动（无统计）退化为配置顺序，保证默认行为与可复现性
 *  3. 失败兜底：某源失败（网络/超时/限流）自动回退到下一个源
 *  4. 熔断保护：连续失败的源暂时跳过，避免浪费时间
 *  5. 批量拆分：混合标的（如 A股+港股）自动按源拆分，合并返回
 *  6. 统计监控：记录成功率/延迟，供调试面板展示
 *  7. 请求合并：并发同形调用共享同一在途 Promise（coalescing），防多轮询方 QPS 放大
 *    （RouterOptions.coalesce = false 可关闭，测试可禁用）
 *
 * 设计原则：
 *  - 单一职责：只做调度，不关心具体业务逻辑
 *  - 能力自声明：源自己说能做什么，路由器不硬编码能力矩阵
 *  - 优雅降级：能返回多少返回多少，不因部分失败而整体失败
 *  - 可观测：所有请求都有统计，便于排查问题
 *  - 类型安全：方法名/参数/返回全部由 methods.ts 派生的强类型约束；
 *    唯一的动态分发（按方法名查函数并调用）收敛在 applyMethod 一处。
 */
import { apiStats } from './ApiStabilityStats';
import { DataSourceError } from './MarketDataSource';
import type {
  DataSourceMethod,
  MarketDataSource,
  MethodArgs,
  MethodItem,
  MethodResult,
  MethodRow,
} from './MarketDataSource';
import { SourceHealth } from './SourceHealth';
import { getApiConfig } from './config';
import { InflightCoalescer, stableStringify } from './coalesce';

export type SourceFactory = (id: string) => MarketDataSource;

export interface RouterOptions {
  factory: SourceFactory;
  health?: SourceHealth;
  order?: readonly string[];
  /** 是否启用并发同形请求合并（默认 true；测试可设 false 关闭） */
  coalesce?: boolean;
  /**
   * 是否按稳定分排序调度（默认 true）。
   * true：有 ApiStabilityStats 统计时按综合稳定分降序，优先打最稳的源；
   *       冷启动（无统计）退化为配置顺序。
   * false：始终按配置顺序，便于测试复现。
   */
  stableRouting?: boolean;
}

/** 判断是否为「不支持该能力」的正常兜底错误 */
export function isUnsupportedError(err: unknown): boolean {
  if (!(err instanceof DataSourceError)) return false;
  return err.isUnsupported;
}

/**
 * 全仓唯一的动态分发边界：按方法名在数据源实例上查函数并调用。
 *  - 方法名、参数、返回类型在调用侧已由 MethodArgs/MethodResult 静态校验；
 *  - 此处仅做一次「未类型化函数」断言以完成运行时分发；
 *  - 源未实现该方法时抛 DataSourceError(3004)（能力兜底语义，调用方据此判定 unsupported）。
 */
export async function applyMethod(
  src: MarketDataSource,
  method: DataSourceMethod,
  args: unknown[],
): Promise<unknown> {
  const fn = (src as unknown as Record<string, unknown>)[method];
  if (typeof fn !== 'function') {
    throw new DataSourceError(`数据源未实现方法 ${method}`, src.id, 3004);
  }
  // 唯一的函数调用 cast：动态分发点（见上方注释）
  return (fn as (...a: unknown[]) => Promise<unknown>).apply(src, args);
}

/**
 * 从方法入参中提取可读标的标签，用于失败日志。
 * 覆盖常见形态：
 *  - { code: '002443' } / { code, exchange }
 *  - { symbol: { code: '002443', exchange: 'SZ' } }（getKline / getQuotes）
 *  - 数组入参（批量）取前几个 code
 */
function formatSymbolTag(args: unknown[]): string {
  const pickCode = (v: unknown): string | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as { code?: unknown; exchange?: unknown; symbol?: unknown };
    if (typeof o.code === 'string' && o.code) {
      return typeof o.exchange === 'string' && o.exchange ? `${o.exchange}.${o.code}` : o.code;
    }
    if (o.symbol && typeof o.symbol === 'object') {
      const s = o.symbol as { code?: unknown; exchange?: unknown };
      if (typeof s.code === 'string' && s.code) {
        return typeof s.exchange === 'string' && s.exchange ? `${s.exchange}.${s.code}` : s.code;
      }
    }
    return null;
  };

  for (const arg of args) {
    if (Array.isArray(arg)) {
      const codes = arg
        .map(pickCode)
        .filter((c): c is string => !!c)
        .slice(0, 5);
      if (codes.length > 0) {
        return `symbols=${codes.join(',')}${arg.length > codes.length ? `…(+${arg.length - codes.length})` : ''}`;
      }
      continue;
    }
    const one = pickCode(arg);
    if (one) return `symbol=${one}`;
  }
  return '';
}

export class SourceRouter {
  readonly factory: SourceFactory;
  readonly health: SourceHealth;
  private orderOverride?: readonly string[];
  /** 是否按稳定分排序调度（默认开） */
  private readonly stableRouting: boolean;

  /** 最后一次成功使用的源 id，便于调试 */
  lastSourceId: string | null = null;

  /** 在途合并注册表（并发同键共享同一底层请求） */
  private readonly coalescer = new InflightCoalescer();
  /** 是否启用请求合并（默认开） */
  private readonly coalesce: boolean;

  constructor(opts: RouterOptions) {
    this.factory = opts.factory;
    this.health = opts.health ?? new SourceHealth();
    this.orderOverride = opts.order;
    this.coalesce = opts.coalesce ?? true;
    this.stableRouting = opts.stableRouting ?? true;
  }

  /** 获取当前源优先级顺序（冷启动先验 / stableRouting=false 时的实际顺序） */
  sourceOrder(): string[] {
    const cfg = getApiConfig().sourceOrder;
    const base = this.orderOverride ?? (cfg.length > 0 ? cfg : []);
    return [...base];
  }

  /**
   * 计算某次调用的源尝试顺序：在 sourceOrder 基础上，
   * 有运行统计时按各源综合稳定分（成功率+覆盖度，0~100）降序，优先打最稳的源；
   * 冷启动（无统计）或 stableRouting=false 时退化为配置顺序。
   * 注意：此处只排序，不裁剪能力——canCall 检查仍由调用方循环内执行。
   */
  private orderedFor(_method: DataSourceMethod, _args: unknown[]): string[] {
    const base = this.sourceOrder();
    if (!this.stableRouting) return base;
    const idx = new Map(base.map((id, i) => [id, i]));
    const scored = base.map((id) => {
      const st = apiStats.getStat(id);
      const cold = !st || st.attempts === 0;
      // 冷启动：保持配置顺序（rank 越小越靠前），不被后置
      const score = cold ? -1 - (idx.get(id) ?? 0) * 1e-3 : apiStats.score(st);
      return { id, score, rank: idx.get(id) ?? 0 };
    });
    scored.sort((x, y) => (y.score !== x.score ? y.score - x.score : x.rank - y.rank));
    return scored.map((s) => s.id);
  }

  /** 尝试获取源实例，失败返回 null */
  private trySource(id: string): MarketDataSource | null {
    try {
      return this.factory(id);
    } catch {
      return null;
    }
  }

  /**
   * 判断某个源是否能处理指定方法调用。
   * 检查顺序：熔断状态 → 能力声明 → 方法存在 → 参数级 supports
   */
  canCall(src: MarketDataSource, method: DataSourceMethod, args: unknown[]): boolean {
    // 熔断检查
    if (this.health.isOpen(src.id)) return false;

    // 能力声明检查（方法级）
    if (src.capabilities && src.capabilities.size > 0 && !src.capabilities.has(method)) {
      return false;
    }

    // 方法存在性检查
    const fn = (src as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function') return false;

    // 参数级能力检查
    // 动态分发边界 cast：supports 契约为 MethodArgs<M>，运行时参数统一按 unknown[] 传递
    try {
      if (typeof src.supports === 'function' && !src.supports(method, args as MethodArgs<DataSourceMethod>)) {
        return false;
      }
    } catch {
      /* supports 异常视为可试，不阻断 */
    }

    return true;
  }

  /**
   * 解析某次调用的源尝试顺序（已裁剪能力/熔断/参数级 supports）。
   * 返回按优先级排序的源 id 列表。
   */
  resolve(method: DataSourceMethod, args: unknown[]): string[] {
    return this.orderedFor(method, args).filter((id) => {
      const src = this.trySource(id);
      return !!src && this.canCall(src, method, args);
    });
  }

  /**
   * 调用指定方法，自动按优先级尝试各源，返回第一个成功结果。
   * 全部失败时抛出聚合错误。
   * 类型安全：method 为方法名，args 与方法签名一一对应，返回类型自动派生。
   */
  async invoke<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): Promise<MethodResult<M>> {
    // 动态分发边界：运行期统一按未类型化数组传递参数（类型已在方法签名处校验）
    const a = args as unknown[];
    // 并发同形请求合并：同「方法 + 稳定参数键」的并发调用共享同一在途 Promise
    if (!this.coalesce) return this.doInvoke(method, a) as Promise<MethodResult<M>>;
    const key = `invoke:${method}:${stableStringify(a)}`;
    return this.coalescer.run(key, () => this.doInvoke(method, a)) as Promise<MethodResult<M>>;
  }

  /** invoke 的实际调度循环（抽成私有方法，供合并包装） */
  private async doInvoke(method: DataSourceMethod, args: unknown[]): Promise<unknown> {
    const a = args;
    const order = this.orderedFor(method, a);
    const errors: Record<string, unknown> = {};
    let attempted = 0;
    // 是否有源「如实返回空数组」（列表类方法的无数据信号），以及是否有真实故障。
    let hasEmptyArray = false;
    let hasRealError = false;

    for (const id of order) {
      const src = this.trySource(id);
      if (!src) continue;
      if (!this.canCall(src, method, a)) continue;

      attempted += 1;
      const ctx = apiStats.begin(id, method);

      try {
        const res = await applyMethod(src, method, a);

        // 空结果视为失败，继续下一个源
        if (res === undefined || res === null) {
          errors[id] = new Error(`${id}.${method} returned empty`);
          apiStats.failure(id, method, errors[id]);
          continue;
        }

        // 空数组也视为失败（但空对象不算，因为有些方法返回对象）
        if (Array.isArray(res) && res.length === 0) {
          hasEmptyArray = true;
          errors[id] = new Error(`${id}.${method} returned empty array`);
          apiStats.failure(id, method, errors[id]);
          continue;
        }

        apiStats.success(id, method, ctx);
        this.health.success(id);
        this.lastSourceId = id;
        return res;
      } catch (e) {
        errors[id] = e;

        // 「不支持」属于正常兜底路径，不计入失败统计
        if (isUnsupportedError(e)) continue;

        // 真实故障：记录统计 + 熔断计数（此处不逐条打日志——
        // 多源兜底链中单个源失败是预期路径，只有全部失败时才在下方汇总提示）
        hasRealError = true;
        apiStats.failure(id, method, e);
        this.health.failure(id);
      }
    }

    if (attempted === 0) {
      // 批量/列表类方法：当前参数组合无源覆盖（如纯 .TI 指数行情被各源 supports 裁剪）
      // → 返回空，不抛错。调用方已有空态 UI，避免 LogBox 刷「no data source supports」。
      if (
        method === 'getIndexQuotes' ||
        method === 'getQuotes' ||
        method === 'getIndexKline' ||
        method === 'getKline' ||
        method === 'getValuations'
      ) {
        console.warn(`[SourceRouter] ${method} 无可用数据源，返回空: ${formatSymbolTag(a) || 'n/a'}`);
        return [];
      }
      throw new Error(`no data source supports "${method}"`);
    }

    // 列表类方法：有源如实返回空数组、且全程无真实故障 → 属暂无数据/标的无行情（周末、停牌、
    // 板块等无接口标的），按空结果返回而不是抛“全部失败”，避免把正常空数据当错误。
    if (!hasRealError && hasEmptyArray) {
      return [];
    }

    // 全部失败但原因都是「空/未知标的」→ 视为暂无数据，返回空并降级日志，
    // 避免北交所/新股/停牌等覆盖缺口在 LogBox 刷屏。
    const isKlineMethod = method === 'getKline' || method === 'getIndexKline';
    const allSoft =
      Object.values(errors).length > 0 &&
      Object.values(errors).every((err) => {
        const m = err instanceof Error ? err.message : String(err);
        if (
          /No adjustment events|返回为空|empty|Unknown|无有效数据|not found|不支持|unavailable/i.test(
            m,
          )
        ) {
          return true;
        }
        // K 线：其它源已空 + stock-sdk 通用「K线失败」→ 按暂无数据（停牌/覆盖缺口）
        if (isKlineMethod && /K线失败|分钟K线失败/i.test(m)) {
          return true;
        }
        return false;
      });
    if (allSoft) {
      if (hasRealError) {
        console.warn(`[SourceRouter] ${method} 暂无数据: ${formatSymbolTag(a) || 'n/a'}`);
      }
      return [];
    }

    const detail = Object.entries(errors)
      .map(([id, err]) => `${id}: ${err instanceof Error ? err.message : String(err)}`)
      .join('; ');
    // 从入参提取标的（支持顶层 { code } 与 K 线/行情常见的 { symbol: { code, exchange } }）
    const symTag = formatSymbolTag(a);
    const msg = `all data sources failed for "${method}": ${detail}${symTag ? ` | ${symTag}` : ''}`;
    // 兜底链整体失败时才打一条汇总（含各源原因），便于一次性定位
    if (hasRealError) {
      console.error(`[SourceRouter] ${msg}`);
    }
    throw new Error(msg);
  }

  /**
   * 按标的拆分批量请求：每个源只处理它 supports 的子集，
   * 剩余的交给下一个源，最终合并返回。
   *
   * 适用于 getQuotes 等「混合标的批量查询」场景：
   *  - A股 + 港股混合自选：同花顺拉 A股，stock-sdk 补港股
   *  - 对调用方仍是一次调用，返回顺序与入参一致
   *
   * 类型安全：items 元素类型 = 方法首参数组元素（MethodItem 派生），
   * 结果行类型 = 方法返回数组元素（MethodRow 派生），无需调用方再标注。
   *
   * @param method 方法名
   * @param items 待查询的项目列表（如 Symbol[]）
   * @param itemKey 从项目提取唯一键的函数
   * @param resultKey 从结果提取唯一键的函数
   * @param wrapArgs 把子集包装成方法参数的函数（保持 unknown[]，分发边界内）
   */
  async partition<M extends DataSourceMethod>(
    method: M,
    items: MethodItem<M>[],
    itemKey: (item: MethodItem<M>) => string,
    resultKey: (row: MethodRow<M>) => string,
    wrapArgs: (subset: MethodItem<M>[]) => unknown[],
  ): Promise<MethodRow<M>[]> {
    if (items.length === 0) return [];
    // 并发同形请求合并：同「方法 + 稳定标的键集合」的并发调用共享同一在途 Promise
    if (this.coalesce) {
      const itemKeys = items.map(itemKey).sort();
      const key = `partition:${method}:${stableStringify(itemKeys)}`;
      return this.coalescer.run(
        key,
        () => this.doPartition(method, items, itemKey, resultKey, wrapArgs),
      ) as Promise<MethodRow<M>[]>;
    }
    return this.doPartition(method, items, itemKey, resultKey, wrapArgs);
  }

  /** partition 的实际拆分合并循环（抽成私有方法，供合并包装） */
  private async doPartition<M extends DataSourceMethod>(
    method: M,
    items: MethodItem<M>[],
    itemKey: (item: MethodItem<M>) => string,
    resultKey: (row: MethodRow<M>) => string,
    wrapArgs: (subset: MethodItem<M>[]) => unknown[],
  ): Promise<MethodRow<M>[]> {
    if (items.length === 0) return [];

    const remaining = new Map(items.map((i) => [itemKey(i), i]));
    const collected = new Map<string, MethodRow<M>>();
    const errors: Record<string, unknown> = {};

    for (const id of this.orderedFor(method, [])) {
      if (remaining.size === 0) break;

      const src = this.trySource(id);
      if (!src) continue;

      // 筛选出本源能处理的子集
      const subset = [...remaining.values()].filter((item) =>
        this.canCall(src, method, wrapArgs([item])),
      );
      if (subset.length === 0) continue;

      const ctx = apiStats.begin(id, method);

      try {
        const rows = await applyMethod(src, method, wrapArgs(subset));

        if (!Array.isArray(rows)) {
          errors[id] = new Error(`${id}.${method} did not return array`);
          apiStats.failure(id, method, errors[id]);
          continue;
        }

        // 分发边界 cast：运行期结果统一收敛到方法返回行类型（MethodRow 派生）
        const list = rows as unknown as MethodRow<M>[];
        // 收集结果，只收集还没被处理的
        for (const row of list) {
          const k = resultKey(row);
          if (remaining.has(k) && !collected.has(k)) {
            collected.set(k, row);
            remaining.delete(k);
          }
        }

        apiStats.success(id, method, ctx);
        this.health.success(id);
        this.lastSourceId = id;
      } catch (e) {
        errors[id] = e;

        // 「不支持」属于正常兜底，跳过
        if (isUnsupportedError(e)) continue;

        // 真实故障：记录统计 + 熔断计数
        apiStats.failure(id, method, e);
        this.health.failure(id);
      }
    }

    // 按入参顺序返回已收集的结果
    const ordered = items
      .map((i) => collected.get(itemKey(i)))
      .filter((r): r is MethodRow<M> => r != null);

    if (ordered.length === 0) {
      // 没有真实异常且什么都没取到 → 各源“如实返回空”，视为无数据而非故障
      if (Object.keys(errors).length === 0) return [];

      // 全部失败但都是「未知标的/空/不支持」→ 返回空，避免 jj007000 等脏码刷 LogBox
      const allSoft =
        Object.values(errors).length > 0 &&
        Object.values(errors).every((err) => {
          const m = err instanceof Error ? err.message : String(err);
          return /No adjustment events|返回为空|empty|Unknown|无有效数据|not found|不支持|unavailable|did not return array/i.test(
            m,
          );
        });
      if (allSoft) {
        console.warn(
          `[SourceRouter] ${method} 批量暂无数据: ${items.map(itemKey).slice(0, 5).join(',')}`,
        );
        return [];
      }

      const detail = Object.entries(errors)
        .map(([id, err]) => `${id}: ${err instanceof Error ? err.message : String(err)}`)
        .join('; ');
      const keys = items
        .map(itemKey)
        .slice(0, 5)
        .join(',');
      const more = items.length > 5 ? `…(+${items.length - 5})` : '';
      throw new Error(
        `all data sources failed for "${method}": ${detail || 'no result'} | n=${items.length}${keys ? ` items=${keys}${more}` : ''}`,
      );
    }

    return ordered;
  }

  /** 重置熔断状态（测试用） */
  resetHealth(): void {
    this.health.reset();
  }

  /** 清空在途合并条目（测试用） */
  clearInflight(): void {
    this.coalescer.clear();
  }
}
