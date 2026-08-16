/**
 * capability.ts —— 参数级能力裁剪：声明式 CapabilitySpec 数据表 + 唯一通用决策引擎。
 *
 * 背景（P1 架构收敛）：
 *  此前每个数据源各自手写 supports() 的 if/else 分支（方法名清单 + 交易所白名单 + 周期白名单），
 *  规则散落在各源文件里，加新源/新方法要逐处抄写、极易漂移。
 *
 * 本模块把参数级规则收敛为「数据表 + 引擎」两层：
 *  - CapabilitySpec：源以声明式数据表描述自己的参数级限制（K线周期 / 单标 / 批量 / 指数 四组白名单）；
 *  - capabilitySupports()：全仓唯一的通用决策引擎，按方法分组常量 × spec 白名单统一判断。
 *  BaseMarketDataSource.supports() 由 spec 数据表驱动，源文件不再手写分支；
 *  有特殊规则（如 stock-sdk 的 BK 板块码格式）的源可 override supports 后委托 super 兜底通用部分。
 *
 * 方法→分组 映射（类型安全：常量表元素均为 DataSourceMethod 字面量，拼错即编译错）：
 *  - KLINE：getKline / getIndexKline —— 周期敏感（klinePeriods 白名单）；
 *  - BATCH：getQuotes / getValuations / getAnomalyByStocks —— 首参 Symbol[]，整体校验（batchExchanges）；
 *  - INDEX：getIndexQuotes / getIndexKline / getIndexConstituents —— 指数代码体系（indexExchanges）；
 *  - SINGLE：getKline / getOrderBook / 财务 / 基金 / 热度 等单标方法（singleSymbolExchanges）。
 *  一个方法可同属多组（如 getKline ∈ KLINE + SINGLE），引擎按 KLINE → 交易所 顺序依次求值，
 *  与既有手写 supports 的 if/else 链语义逐字对齐（行为保持不变，四源 supports 测试为防线）。
 */
import type { DataSourceMethod } from './MarketDataSource';
import type { Exchange, KlinePeriod } from './types';

// ============================================================
// 方法分组常量（类型安全：DataSourceMethod 字面量，编译期校验）
// ============================================================

/** K 线类（周期敏感）方法 */
export const KLINE_METHODS = ['getKline', 'getIndexKline'] as const;
export type KlineMethod = (typeof KLINE_METHODS)[number];

/** 批量标的（首参 Symbol[]）方法 */
export const BATCH_SYMBOL_METHODS = ['getQuotes', 'getValuations', 'getAnomalyByStocks'] as const;
export type BatchSymbolMethod = (typeof BATCH_SYMBOL_METHODS)[number];

/** 指数/板块类方法（代码体系 .SH / .SZ / .TI） */
export const INDEX_METHODS = ['getIndexQuotes', 'getIndexKline', 'getIndexConstituents'] as const;
export type IndexMethod = (typeof INDEX_METHODS)[number];

/** 单标的类方法（symbol 在首参，或嵌套在 params.symbol 等字段里） */
export const SINGLE_SYMBOL_METHODS = [
  'getKline',
  'getOrderBook',
  'getAdjustmentFactors',
  'getIncomeStatements',
  'getBalanceSheets',
  'getCashFlowStatements',
  'getFinancialIndicators',
  'getFundProfile',
  'getFundHoldings',
  'getFundNav',
  'getFundReturns',
  'getFundHolders',
  'getFundMarketSnapshot',
  'getFundHistorical',
  'getHotStockRankTrend',
] as const;
export type SingleSymbolMethod = (typeof SINGLE_SYMBOL_METHODS)[number];

// ============================================================
// CapabilitySpec：参数级能力规格（声明式数据表）
// ============================================================

export interface CapabilitySpec {
  /** K 线周期白名单（作用于 getKline / getIndexKline；undefined = 不限制） */
  klinePeriods?: readonly KlinePeriod[];
  /** 单标的类方法允许的交易所（undefined = 不限制） */
  singleSymbolExchanges?: readonly Exchange[];
  /** 批量类方法（Symbol[]）允许的交易所（undefined = 不限制） */
  batchExchanges?: readonly Exchange[];
  /** 指数/板块类方法允许的交易所（.SH/.SZ/.TI，undefined = 不限制） */
  indexExchanges?: readonly Exchange[];
}

/**
 * 空规格 = 无参数级限制。
 * 基类默认值：所有参数级组合放行，方法级裁剪由 capabilities 完成（如 fund-api 源）。
 */
export const EMPTY_CAPABILITY_SPEC: CapabilitySpec = {};

// ============================================================
// 通用决策引擎
// ============================================================

/** 标的形状（运行时松散窄化：仅需能读出 exchange，不依赖完整 Symbol 类型） */
interface SymbolLike {
  code?: unknown;
  exchange?: Exchange;
}

/** 判断一个值是否「像标的」（含 code + exchange 的对象） */
function isSymbolLike(v: unknown): v is SymbolLike {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return 'code' in o && 'exchange' in o;
}

/**
 * 提取一次调用涉及的标的（统一语义，与各源既有手写 supports 的提取规则一致）：
 *  - 首参是数组 → 其中所有「像标的」的元素（批量语义，整批校验）；
 *  - 首参是 { symbol: ... } 结构 → 嵌套的 symbol 字段（如 KlineParams / 财务参数）；
 *  - 首参本身就是标的（{ code, exchange }）→ 自身；
 *  - 其它（无标的的方法、字符串/数字参数、缺省参数）→ 空数组（引擎视为「无需裁剪」）。
 */
export function extractSymbols(args: readonly unknown[]): SymbolLike[] {
  const first = args[0];
  if (Array.isArray(first)) {
    return first.filter(isSymbolLike);
  }
  if (first && typeof first === 'object') {
    const nested = (first as Record<string, unknown>).symbol;
    if (nested != null && typeof nested === 'object') {
      return isSymbolLike(nested) ? [nested as SymbolLike] : [];
    }
    if (isSymbolLike(first)) return [first as SymbolLike];
  }
  return [];
}

/** 判断方法是否属于 K 线分组 */
function isKlineMethod(method: DataSourceMethod): boolean {
  return method === 'getKline' || method === 'getIndexKline';
}

/** 判断方法是否属于批量分组 */
function isBatchMethod(method: DataSourceMethod): boolean {
  return (BATCH_SYMBOL_METHODS as readonly string[]).includes(method);
}

/** 判断方法是否属于指数分组 */
function isIndexMethod(method: DataSourceMethod): boolean {
  return (INDEX_METHODS as readonly string[]).includes(method);
}

/** 判断方法是否属于单标分组 */
function isSingleSymbolMethod(method: DataSourceMethod): boolean {
  return (SINGLE_SYMBOL_METHODS as readonly string[]).includes(method);
}

/**
 * 通用参数级能力判断（CapabilitySpec 数据表驱动）。
 *
 * 语义（与既有手写 supports 逐字对齐）：
 *  1. K 线周期：params.period 已给出且不在白名单 → false；period 缺省 → 放行（方法体内有默认值）；
 *  2. 交易所白名单（优先级 INDEX > BATCH > SINGLE，与手写 if/else 链一致）：
 *     取白名单 → 提取标的 → 无标的信息则放行；有标的则要求「全部」命中白名单，否则 false。
 *  3. 空 spec / 方法不在任何分组 → true（全支持）。
 *
 * 动态分发边界：method 为方法名联合，args 运行期统一按未类型化数组读取。
 */
export function capabilitySupports(
  spec: CapabilitySpec,
  method: DataSourceMethod,
  args: readonly unknown[],
): boolean {
  // 1) K 线周期白名单（getKline / getIndexKline 首参均为 KlineParams）
  if (isKlineMethod(method)) {
    const periods = spec.klinePeriods;
    if (periods && periods.length > 0) {
      const period = (args[0] as { period?: KlinePeriod } | undefined)?.period;
      if (period != null && !periods.includes(period)) return false;
    }
  }

  // 2) 交易所白名单（INDEX > BATCH > SINGLE 优先级）
  let whitelist: readonly Exchange[] | undefined;
  if (isIndexMethod(method)) {
    whitelist = spec.indexExchanges;
  } else if (isBatchMethod(method)) {
    whitelist = spec.batchExchanges;
  } else if (isSingleSymbolMethod(method)) {
    whitelist = spec.singleSymbolExchanges;
  }
  if (!whitelist || whitelist.length === 0) return true;

  const symbols = extractSymbols(args);
  if (symbols.length === 0) return true;
  return symbols.every((s) => s.exchange != null && (whitelist as readonly string[]).includes(s.exchange));
}
