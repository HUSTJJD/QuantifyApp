/**
 * MarketDataSource —— 数据源统一抽象接口（端口 / Port）。
 *
 * 这是整个 API 层的核心契约：上层只依赖这个接口，不关心底层是同花顺官方 REST
 * 还是 stock-sdk。任意新的数据源只要实现本接口，即可通过 SourceRouter 无缝切换。
 *
 * 设计要点：
 *  - 核心能力（34 个方法）在接口中明确定义，所有源必须实现；
 *  - 扩展能力（54 个方法，如 stock-sdk 专属板块/资金流等）在接口中为 Partial，各源按需实现；
 *  - 所有方法返回 Promise，统一异步契约；
 *  - 跨数据源差异（代码后缀、字段命名、周期枚举）都在具体实现里消化；
 *  - 方法失败统一抛出 DataSourceError，便于上层做错误分类与重试；
 *  - 不支持的能力应抛出带明确 code (3004) 的 DataSourceError，
 *    由 SourceRouter 决定是否降级到其它源。
 *
 * 方法签名不在此文件维护：88 个方法名/参数/返回类型全部由 methods.ts 的
 * DataSourceCoreMethods / DataSourceExtendedMethods 两个签名接口派生（唯一真相源），
 * 本接口只定义「源实例」的元信息、能力自声明与生命周期契约。
 */
import type {
  DataSourceCoreMethods,
  DataSourceExtendedMethods,
  DataSourceMethod,
  MethodArgs,
} from './methods';

// 方法签名契约统一从 methods.ts 派生，此处 re-export 保持既有 import 路径可用
export type {
  DataSourceCoreMethod,
  DataSourceExtendedMethod,
  DataSourceMethod,
  DataSourceCoreMethods,
  DataSourceExtendedMethods,
  MethodArgs,
  MethodResult,
  MethodItem,
  MethodRow,
} from './methods';

/** 数据源统一错误，携带来源标识与上游 code 便于排查 */
export class DataSourceError extends Error {
  /** 上游业务 code（如 3004 不支持），可选 */
  readonly upstreamCode?: number | string;
  constructor(
    message: string,
    public readonly sourceId: string,
    upstreamCode?: number | string,
    public readonly cause?: unknown,
  ) {
    super(`[${sourceId}] ${message}`);
    this.name = 'DataSourceError';
    this.upstreamCode = upstreamCode;
  }

  /** 是否可在有界次数内退避重试 */
  get retryable(): boolean {
    const code = this.upstreamCode;
    if (code === undefined) return true; // 网络错误（无上游 code）
    if (code === 4001) return true; // 限流
    if (typeof code === 'string') return code.startsWith('500');
    return code >= 5000 && code <= 5003;
  }

  /** 是否为「不支持该能力」的正常兜底错误（不应刷 ERROR 日志） */
  get isUnsupported(): boolean {
    return this.upstreamCode === 3004 || this.upstreamCode === 1002;
  }
}

/**
 * 数据源核心接口。
 *
 * 方法契约全部继承自 methods.ts：
 *  - 34 个核心方法（DataSourceCoreMethods）所有源必须实现；
 *    不支持的方法应抛出 DataSourceError(3004)，由 SourceRouter 自动路由到下一个源。
 *  - 54 个扩展方法（DataSourceExtendedMethods，期权/资金流等 SDK 专属能力）为可选（Partial），
 *    各源按需实现；调用方通过 SourceRouter.invoke() 统一入口动态调用。
 *  - 各源额外的 SDK 专属公开方法（如 getKlineHK / getBoardConstituents）不受本接口约束。
 */
export interface MarketDataSource extends DataSourceCoreMethods, Partial<DataSourceExtendedMethods> {
  /** 数据源唯一标识，例如 'hithsa' | 'stock-sdk' */
  readonly id: string;
  /** 数据源可读名称，用于 UI 展示 */
  readonly label: string;

  /**
   * 能力自声明：本源原生支持的方法白名单（方法级裁剪）。
   * SourceRouter 据此裁剪路由顺序：未声明的方法直接跳过。
   * 强类型：只能是 DataSourceMethod 中定义的方法名。
   */
  readonly capabilities: ReadonlySet<DataSourceMethod>;

  /**
   * 参数级能力裁剪：对具体参数判断是否支持（如同花顺仅沪深 A 股、分钟K 受限）。
   * 返回 false 时 SourceRouter 跳过本源。
   * 强类型：method 为方法名，args 与方法签名参数一一对应（MethodArgs 派生）。
   */
  supports<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): boolean;

  /** 初始化（建立连接 / 预热缓存等），可重复调用 */
  init(): Promise<void>;
  /** 释放资源 */
  dispose(): Promise<void>;
}
