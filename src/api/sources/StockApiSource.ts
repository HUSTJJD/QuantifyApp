/**
 * StockApiSource —— 对 npm:stock-api 包的【纯封装】数据源。
 *
 * 设计原则（与“通用行情源 API 封装”诉求一致）：
 *  - 本类只薄薄包一层 stock-api 的 `stocks.auto`（auto 会按运行环境自动选 best provider），
 *    不掺杂任何腾讯直连 / 自建 HTTP / 手写周期映射等额外逻辑；
 *  - stock-api 库内部已统一处理代码格式（SH600519 大写）、字段归一化，
 *    本类仅做「库返回结构 -> 本项目统一类型」的映射，差异消化在 source 内部；
 *  - 库不支持或返回空（如复权 K 线、部分市场）时，抛出 DataSourceError(3004)，
 *    交由 MarketDataClient 路由到 stock-sdk 等兜底源；
 *  - 本源仅覆盖：行情快照(getQuotes) / K线(getKline) / 搜索(search)；
 *    盘口、财务、估值、指数、基金、特色数据等一律继承自 BaseMarketDataSource 抛 3004。
 *
 * ⚠️ stock-api 客观限制（实测）：getKlines 的 adjust 仅 'none' 可用，
 *   forward/backward 在腾讯源下返回空，故复权 K 线由 stock-sdk 兜底。
 */
import stockApi from 'stock-api';
import { BaseMarketDataSource } from './BaseMarketDataSource';
import type {
  Symbol as UnifiedSymbol,
  Quote,
  Candle,
  SearchParams,
  KlineParams,
  Instrument,
} from '../types';

const SOURCE_ID = 'stock-api';

/** 本项目 Symbol -> stock-api 库 code（大写无点，如 SH600519 / HK00700） */
function toProviderCode(symbol: UnifiedSymbol): string {
  return `${symbol.exchange}${symbol.code}`.toUpperCase();
}

/** stock-api 库返回的 code（如 SH600519）-> 本项目统一 Symbol */
function fromProviderCode(code: string): UnifiedSymbol {
  const m = code.match(/^(SH|SZ|BJ|HK|US)(.+)$/);
  if (m) return { code: m[2], exchange: m[1] as UnifiedSymbol['exchange'] };
  return { code, exchange: 'SH' };
}

/** stock-api 库的 Stock/Kline 结构（仅列出本类用到的字段） */
interface StockApiStock {
  code: string;
  name?: string;
  percent?: number;
  now?: number;
  yesterday?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  amount?: number;
  turnover?: number;
}
interface StockApiKline {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  amount?: number;
}

const auto = stockApi.stocks.auto;

export class StockApiSource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'stock-api(npm:stock-api)';
  private initialized = false;

  async init(): Promise<void> {
    this.initialized = true;
  }
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /** 实时行情：透传 stock-api.getStocks，映射到统一 Quote */
  async getQuotes(symbols: UnifiedSymbol[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const codes = symbols.map(toProviderCode);
    const stocks = (await auto.getStocks(codes)) as StockApiStock[];
    const byCode = new Map(stocks.map((s) => [s.code, s]));
    const out: Quote[] = [];
    for (const sym of symbols) {
      const raw = byCode.get(toProviderCode(sym));
      if (!raw) continue;
      out.push({
        symbol: fromProviderCode(raw.code),
        last: raw.now ?? 0,
        prevClose: raw.yesterday ?? 0,
        open: raw.open ?? 0,
        high: raw.high ?? 0,
        low: raw.low ?? 0,
        volume: raw.volume ?? 0,
        amount: raw.amount ?? raw.turnover ?? 0,
        changePct: raw.percent != null ? raw.percent * 100 : undefined,
        updatedAt: Date.now(),
      });
    }
    return out;
  }

  /** K 线：透传 stock-api.getKlines，映射到统一 Candle */
  async getKline(params: KlineParams): Promise<Candle[]> {
    const { symbol, period, adjust, count } = params;
    // stock-api 仅 'none' 复权可用；forward/backward 由 stock-sdk 兜底
    if (adjust && adjust !== 'none') {
      return this.unsupported(`getKline(adjust=${adjust})`);
    }
    const opts: Record<string, unknown> = { period, count: count ?? 240 };
    const kl = (await auto.getKlines(toProviderCode(symbol), opts)) as StockApiKline[];
    if (!kl || kl.length === 0) {
      return this.unsupported('getKline(empty)');
    }
    return kl.map((k) => ({
      datetime: k.date,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume ?? 0,
      amount: k.amount,
    }));
  }

  /** 搜索：透传 stock-api.searchStocks，映射到统一 Instrument */
  async search(params: SearchParams): Promise<Instrument[]> {
    const raw = (await auto.searchStocks(params.keyword)) as StockApiStock[];
    const list = Array.isArray(raw) ? raw : [];
    const limited = params.limit ? list.slice(0, params.limit) : list;
    return limited.map((s) => {
      const sym = fromProviderCode(s.code);
      return {
        symbol: sym,
        name: s.name ?? '',
        market: sym.exchange === 'HK' ? 'HK' : sym.exchange === 'US' ? 'US' : 'A',
      };
    });
  }
}
