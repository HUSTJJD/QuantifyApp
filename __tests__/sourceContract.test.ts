/**
 * sourceContract.test.ts —— 行情源统一契约测试（能力维度，P0）。
 *
 * 三个源（fuyao / hithsa / stock-sdk）+ fund-api 共用同一套断言：
 *  1. 能力一致性：capabilities 声明 ⇔ 类里真实 override ⇔ expectations 期望，三者不允许漂移；
 *  2. 不支持语义：期望不支持的方法必须抛 DataSourceError(3004)，
 *     禁止「返回空数组冒充成功」——那会让 SourceRouter 停止兜底；
 *  3. 闲置能力：源上实现了但不在 88 个接口方法内的方法（SourceRouter 永远路由不到）
 *     必须登记在 KNOWN_SOURCE_ONLY 里；源新增方法而未补录/未登记时，本测试失败。
 *
 * 不联网：只调用「按期望应当直接 3004」的方法，其余仅做静态比对。
 * 请求/响应契约（端点、参数、字段映射）由 P1 的 fixture 测试补充。
 */
import { HithsaApiSource } from '@/data/api/sources/HithsaApiSource';
import { HithsaHttpClient } from '@/data/api/sources/HithsaHttpClient';
import { FuyaoApiSource } from '@/data/api/sources/FuyaoApiSource';
import { StockSdkSource } from '@/data/api/sources/StockSdkSource';
import { FundApiSource } from '@/data/api/sources/FundApiSource';
import { auditSource } from '@/data/api/contract/audit';
import { probeUnsupportedSemantics } from '@/data/api/contract/runner';
import { ALL_METHODS } from '@/data/api/contract/catalog';
import type { MarketDataSource } from '@/data/api';

/**
 * 已登记的「接口外闲置能力」白名单。
 * 每补录一个（接入 DataSourceMethod 并声明 capabilities），就从这里删掉一个；
 * 清单清空 = 该源能力被完全榨干。新增未登记方法会直接让测试失败。
 */
const KNOWN_SOURCE_ONLY: Record<string, string[]> = {
  // stock-sdk：源上接口外闲置能力白名单（P2 后接口方法数为 122）。
  // P0-A/P0-B/P1-A/P1-B/P2 已完成主要补录。
  // 仍闲置：源专属别名（getQuotesHK/US、getKlineHK/US、getTodayTimeline*）、
  // 已被统一方法覆盖的原始透传（getStockFundFlow、getSectorFundFlowRank）、
  // 以及 screen/backtest（选股回测，需另立契约）。
  'stock-sdk': [
    'addIndicators', 'backtest', 'calcChipDistribution', 'calcSignals', 'getAllQuotes',
    'getBlockTradeDetail', 'getBoardChanges', 'getBoardConstituents',
    'getBoardQuotes', 'getCodeList',
    'getFundFlowRank', 'getFundQuotes', 'getFundThemeList',
    'getIndividualChangesHistory', 'getIndustryBoardSpot',
    'getIndustryMinuteKline', 'getKlineHK', 'getKlineUS',
    'getMarketOverviewCN',
    'getMinuteKlineCN', 'getMinuteKlineHK', 'getMinuteKlineUS',
    'getOptionCommodityKline', 'getOptionCommoditySpot', 'getOptionEtfDailyKline',
    'getOptionEtfFiveDayMinute', 'getOptionIndexKline', 'getOptionIndexSpot',
    'getOrderBookHK', 'getOrderBookUS',
    'getQuotesBatch',
    'getQuotesHK', 'getQuotesSimpleCN', 'getQuotesUS', 'getRealTimeTicks',
    'getSectorFundFlowRank', 'getStockFundFlow',
    'getTodayTimelineCN', 'getTodayTimelineHK', 'getTodayTimelineUS',
    'resolveSymbol', 'screen',
    'getConceptBoardList', 'getConceptBoardSpot', 'getConceptKline', 'getConceptMinuteKline',
  ],
};

function buildSources(): MarketDataSource[] {
  return [
    new FuyaoApiSource(() => 'test-key'),
    new HithsaApiSource(new HithsaHttpClient()),
    new StockSdkSource(),
    new FundApiSource(),
  ];
}

/** 漂移类缺口（不含接口外闲置能力，后者单独由白名单管控） */
const DRIFT_KINDS = [
  'declared-but-unsupported',
  'declared-but-not-implemented',
  'missing-supported',
  'unexpected-declared',
];

describe('行情源统一契约 · 能力一致性', () => {
  it.each(buildSources())('$id 的声明 / 实现 / 期望三者一致', src => {
    const audit = auditSource(src);
    const drifts = audit.gaps.filter(g => DRIFT_KINDS.includes(g.kind));
    expect(drifts.map(g => `${g.kind}:${g.method} — ${g.detail}`)).toEqual([]);
  });

  it('接口方法目录完整（与 methods.ts 签名集一致）', () => {
    // 目录由类型强制完整；这里守住运行时数量，防止手改遗漏
    // P1-B 后 107；P2 闭环补录 15 项
    expect(ALL_METHODS.length).toBe(122);
    expect(new Set(ALL_METHODS).size).toBe(122);
  });
});

describe('行情源统一契约 · 不支持语义', () => {
  it.each(buildSources())('$id 期望不支持的方法都正确抛 3004', async src => {
    const rows = await probeUnsupportedSemantics(src);
    const bad = rows.filter(r => r.status === 'fail');
    expect(bad.map(r => `${r.method} — ${r.detail}`)).toEqual([]);
    // 覆盖到全部「期望非 supported」的方法
    expect(rows.length).toBeGreaterThan(0);
  }, 30000);
});

describe('行情源统一契约 · 闲置能力（待补录）', () => {
  it.each(buildSources())('$id 没有超出白名单的新增闲置能力', src => {
    const audit = auditSource(src);
    const known = new Set(KNOWN_SOURCE_ONLY[src.id] ?? []);
    const unknown = audit.sourceOnlyMethods.filter(m => !known.has(m));
    expect(unknown).toEqual([]);
  });

  it('输出闲置能力清单（补录进度）', () => {
    const report = buildSources()
      .map(src => {
        const a = auditSource(src);
        return [
          `${a.sourceId}: 声明 ${a.declaredCount} / 实现 ${a.implementedCount} / 闲置 ${a.sourceOnlyMethods.length}`,
          `  闲置清单: ${a.sourceOnlyMethods.join(', ')}`,
        ].join('\n');
      })
      .join('\n');
    // 仅供 CI 日志查看补录进度
    console.info(`[source-contract] 能力概况\n${report}`);
    expect(report).toContain('stock-sdk');
  });
});
