/**
 * contract/expectations.ts —— 每个源 × 每个方法的「期望态」（能力维度）。
 *
 * 三态模型（与 audit.ts 的判定一一对应）：
 *  - supported   ：源声明且真实实现，能返回有效数据（由 P1 的请求/响应契约验证"对不对"）
 *  - unsupported ：源不提供该能力，调用必须抛 DataSourceError(3004)（正常兜底语义）
 *  - absent      ：源没有该方法（由 BaseMarketDataSource 兜底 3004），与 unsupported 语义等价但来源不同
 *
 * 未列出的默认 absent，避免 88×4 全量铺开导致维护负担。
 * 期望写错 → 一致性测试失败；源能力变化 → 测试失败 → 强制回来改期望或改实现。
 */
import type { DataSourceMethod } from '@/data/api';

export type ExpectationKind = 'supported' | 'unsupported' | 'absent';

export interface SourceExpectationSet {
  sourceId: string;
  /** 期望真实支持的方法 */
  supported: DataSourceMethod[];
  /** 期望明确不支持（必须抛 3004）的方法 */
  unsupported: DataSourceMethod[];
  /** 逐方法备注：记录漂移、存疑、待办 */
  notes?: Partial<Record<DataSourceMethod, string>>;
}

/** fuyao：同花顺官方 SDK 主源 */
const FUYAO: SourceExpectationSet = {
  sourceId: 'fuyao',
  supported: [
    'listTickers', 'search', 'getQuotes', 'getKline',
    'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'getFinancials',
    'getAdjustmentFactors', 'listIndices', 'getIndexConstituents', 'getIndexQuotes',
    'getIndexKline', 'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns',
    'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getLimitDownPool', 'getLimitBreakPool',
    'getAnomalyList', 'getAnomalyByStocks',
    'getAuctionSnapshot', 'getShortTermBenchmark',
    'getSkyrocketList', 'getHotStockList', 'getHotStockListHistory', 'getHotStockRankTrend',
    'getDragonTigerList', 'getTradingDays',
  ],
  unsupported: ['getOrderBook', 'getProfitForecast'],
  notes: {
    getOrderBook: '声明了 capabilities 但实现体直接抛 3004：应从 capabilities 移除，否则路由会白白尝试一次',
    getProfitForecast: '官方无盈利预测端点：实现体 3004，未声明 capabilities',
  },
};

/** hithsa：同花顺官方 REST 次主源 */
const HITHSA: SourceExpectationSet = {
  sourceId: 'hithsa',
  supported: [
    'listTickers', 'search', 'getQuotes', 'getKline',
    'getValuations', 'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'getFinancials',
    'getAdjustmentFactors', 'listIndices', 'getIndexConstituents', 'getIndexQuotes',
    'getIndexKline', 'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns',
    'getFundHolders', 'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getAnomalyList', 'getAnomalyByStocks',
    'getSkyrocketList', 'getHotStockList', 'getHotStockListHistory', 'getHotStockRankTrend',
    'getDragonTigerList', 'getTradingDays',
  ],
  unsupported: ['getOrderBook', 'getProfitForecast'],
  notes: {
    getIndexQuotes: '对纯 .TI（同花顺板块指数）请求内部降级返回空数组：属"能力不覆盖"，首页板块行情因此为空',
    getProfitForecast: '官方无盈利预测端点：实现体 3004，未声明 capabilities',
  },
};

/** stock-sdk：兜底源（P1-A 后声明 56 项） */
const STOCK_SDK: SourceExpectationSet = {
  sourceId: 'stock-sdk',
  supported: [
    'listTickers', 'search', 'getQuotes', 'getKline', 'getOrderBook', 'getAdjustmentFactors',
    'getValuations', 'listIndices', 'getIndexConstituents', 'getIndexQuotes', 'getIndexKline',
    'getFundProfile', 'getFundHoldings', 'getFundNav', 'getFundReturns', 'getFundHolders',
    'getFundMarketSnapshot', 'getFundHistorical',
    'getLimitUpPool', 'getLimitUpLadder', 'getAnomalyList', 'getAnomalyByStocks',
    'getSkyrocketList', 'getHotStockList', 'getDragonTigerList', 'getTradingDays',
    'getStockIndustryBoard',
    'getIntraday',
    'getOptionQuotes', 'getOptionKline', 'getOptionCffexQuotes', 'getOptionLhb',
    'getFuturesKline', 'getFuturesGlobalSpot', 'getFuturesGlobalKline',
    'getFuturesInventorySymbols', 'getFuturesInventory', 'getFuturesComexInventory',
    'getNorthboundMinute', 'getNorthboundSummary', 'getNorthboundHoldingRank',
    'getNorthboundHistory', 'getNorthboundIndividual',
    'getChipDistribution',
    'getMarginAccountInfo', 'getMarginTargetList',
    'getConceptBoards', 'getConceptBoardConstituents', 'getConceptBoardKline',
    // P1-A 资金流
    'getMainForce', 'getStockFundsFlowing', 'getStockHotIndustry',
    'getStockIndustryFundsFlowing', 'getStockTodaySurge',
    // P1-B 行业板块细分 / 龙虎榜细分 / 大宗统计 / 日历状态 / 分红
    'getIndustryBoardConstituents', 'getIndustryBoardKline', 'getSectorFundFlowHistory',
    'getDragonTigerInstitution', 'getDragonTigerBranchRank', 'getDragonTigerSeatDetail',
    'getBlockTradeMarketStat', 'getBlockTradeDailyStat',
    'isTradingDay', 'nextTradingDay', 'prevTradingDay',
    'getDividendDetail',
    // P2 闭环补录
    'getMarketFundFlow', 'getOptionEtfMonths', 'getOptionEtfExpireDay', 'getOptionEtfMinuteKline',
    'getKlineWithIndicators', 'getKlineSignals', 'getStockChangeEvents', 'getIndividualChangeEvents',
    'getDragonTigerStockStats', 'getFundDividendList', 'getFundRankHistory', 'getLargeOrderRatios',
    'getMarketStatus',
  ],
  unsupported: [
    'getIncomeStatements', 'getBalanceSheets', 'getCashFlowStatements',
    'getFinancialIndicators', 'getHotStockListHistory', 'getHotStockRankTrend',
  ],
  notes: {
    getOrderBook: '声明支持，但上游盘口端点当前返回空 bids/asks（网络环境问题，非代码回归）',
  },
};

/** fund-api：基金兜底源（仅 5 项） */
const FUND_API: SourceExpectationSet = {
  sourceId: 'fund-api',
  supported: ['search', 'getFundMarketSnapshot', 'getFundProfile', 'getFundNav', 'getFundHistorical'],
  unsupported: [],
};

export const SOURCE_EXPECTATIONS: SourceExpectationSet[] = [FUYAO, HITHSA, STOCK_SDK, FUND_API];

/** 查某源对某方法的期望态（未列出 = absent） */
export function expectationOf(sourceId: string, method: DataSourceMethod): ExpectationKind {
  const set = SOURCE_EXPECTATIONS.find(s => s.sourceId === sourceId);
  if (!set) return 'absent';
  if (set.supported.includes(method)) return 'supported';
  if (set.unsupported.includes(method)) return 'unsupported';
  return 'absent';
}

/** 取备注 */
export function noteOf(sourceId: string, method: DataSourceMethod): string | undefined {
  return SOURCE_EXPECTATIONS.find(s => s.sourceId === sourceId)?.notes?.[method];
}
