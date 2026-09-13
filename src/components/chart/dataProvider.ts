/**
 * K 线数据提供者（借鉴 kline-charts-react DataProvider）。
 * 默认实现走 marketData（多源路由，含 stock-sdk 兜底），强制不复权取数。
 */
import { marketData } from '@/data/api';
import type { Candle, Symbol } from '@/data/api';
import type { ChartMarket, ChartPeriod, ChartAdjust, KlineDataProvider } from './types';
import { toKlinePeriod, isTimelinePeriod } from './types';

/** Symbol → 市场大类 */
export function chartMarketOf(symbol: Symbol): ChartMarket {
  if (symbol.exchange === 'HK') return 'HK';
  if (symbol.exchange === 'US') return 'US';
  return 'A';
}

/** stock-sdk 简易代码：A 股 sh600519 / 港 00700 / 美 AAPL */
export function toSdkCode(symbol: Symbol): string {
  if (symbol.exchange === 'HK') return symbol.code;
  if (symbol.exchange === 'US') return symbol.code;
  const p = symbol.exchange === 'SZ' ? 'sz' : symbol.exchange === 'BJ' ? 'bj' : 'sh';
  return `${p}${symbol.code}`;
}

const DEFAULT_LIMIT = 180;

/**
 * 默认 Provider：统一走 marketData。
 * - 网络层强制 adjust:'none'；本地复权由上层 adjustment 处理
 * - cursor 向前翻页（endMs）
 */
export function createDefaultKlineProvider(): KlineDataProvider {
  return {
    async getKline({ symbol, period, cursor, limit }) {
      const kPeriod = toKlinePeriod(period);
      const count = limit ?? DEFAULT_LIMIT;
      const candles = await marketData.getKline({
        symbol,
        period: kPeriod,
        count,
        endMs: cursor,
        adjust: 'none',
      });
      return (candles ?? []).slice().sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    },
    async getTimeline({ symbol }) {
      // 当日分时：1m K 线近似；昨收用日 K 最后一根
      const [mins, days] = await Promise.all([
        marketData.getKline({ symbol, period: '1m', count: 240, adjust: 'none' }),
        marketData.getKline({ symbol, period: 'day', count: 2, adjust: 'none' }).catch(() => []),
      ]);
      const prevClose = days && days.length >= 2 ? days[days.length - 2].close : null;
      return { data: mins ?? [], prevClose };
    },
  };
}

export interface LoadMoreParams {
  symbol: Symbol;
  market: ChartMarket;
  period: ChartPeriod;
  adjust: ChartAdjust;
  /** 当前最早一根的 ms，作为 cursor */
  earliestMs: number;
  limit?: number;
}

/** 供 hook 向前翻页 */
export async function loadEarlierKline(
  provider: KlineDataProvider,
  params: LoadMoreParams,
): Promise<Candle[]> {
  if (isTimelinePeriod(params.period)) return [];
  return provider.getKline({
    symbol: params.symbol,
    market: params.market,
    period: params.period,
    adjust: params.adjust,
    cursor: params.earliestMs - 1,
    limit: params.limit ?? DEFAULT_LIMIT,
  });
}
