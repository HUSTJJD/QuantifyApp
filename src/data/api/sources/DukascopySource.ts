/**
 * DukascopySource —— 全球指数/商品行情源（协议对齐 vendor/dukascopy-node）。
 *
 * 定位：
 *  - 兜底补齐首页全球条（标普/纳指/道指/恒生/日经/DAX…），不参与 A 股调度；
 *  - 仅实现 getQuotes / getKline / search（全球映射表内），其余继承 Base 抛 3004；
 *  - 用 fetch 直连 jetta.dukascopy.com，不把 Node 版 dukascopy-node 打进 RN bundle。
 *
 * 子模块 vendor/dukascopy-node 作为协议与 instrument 元数据的权威参考。
 */
import { BaseMarketDataSource } from './BaseMarketDataSource';
import { DataSourceError } from '../MarketDataSource';
import { register } from '../DataSourceRegistry';
import type { DataSourceMethod, MethodArgs } from '../MarketDataSource';
import type { Candle, Instrument, KlineParams, KlinePeriod, Quote, SearchParams, Symbol } from '../types';
import { DUKASCOPY_INDEXES, findDukascopyInstrument } from './dukascopy/instruments';
import { fetchDayCandles, fetchMinuteCandles } from './dukascopy/client';

const SOURCE_ID = 'dukascopy';

function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

function mapPeriod(period: KlinePeriod | undefined): 'day' | 'minute' {
  return period === '1m' || period === '5m' || period === '15m' || period === '30m' || period === '60m'
    ? 'minute'
    : 'day';
}

export class DukascopySource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'dukascopy(jetta.dukascopy.com)';

  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set([
    'getQuotes',
    'getKline',
    'search',
  ]);

  async init(): Promise<void> {
    // 无状态 HTTP，无需预热
  }
  async dispose(): Promise<void> {
    // noop
  }

  /** 仅映射表内标的可走本源 */
  override supports<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): boolean {
    const a = args as unknown[];
    if (method === 'search') return true;
    if (method === 'getQuotes') {
      const raw = a[0];
      const list = Array.isArray(raw) ? (raw as Symbol[]) : raw ? [raw as Symbol] : [];
      return list.some((s) => s?.code && findDukascopyInstrument(s.code) != null);
    }
    if (method === 'getKline') {
      const p = a[0] as { symbol?: Symbol } | undefined;
      return p?.symbol?.code ? findDukascopyInstrument(p.symbol.code) != null : false;
    }
    return false;
  }

  async search(params: SearchParams): Promise<Instrument[]> {
    const kw = String(params?.keyword ?? '').trim().toLowerCase();
    if (!kw) return [];
    return DUKASCOPY_INDEXES.filter(
      (it) =>
        it.name.toLowerCase().includes(kw) ||
        it.symbolCode.toLowerCase().includes(kw) ||
        it.id.toLowerCase().includes(kw),
    ).map((it) => ({
      symbol: { code: it.symbolCode, exchange: it.exchange, name: it.name },
      name: it.name,
      market: it.exchange === 'HK' ? ('HK' as const) : ('US' as const),
    }));
  }

  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    const targets = symbols
      .map((s) => ({ sym: s, inst: findDukascopyInstrument(s.code) }))
      .filter((x): x is { sym: Symbol; inst: NonNullable<ReturnType<typeof findDukascopyInstrument>> } => !!x.inst);
    if (targets.length === 0) {
      return this.unsupported('getQuotes');
    }

    const out: Quote[] = [];
    const settled = await Promise.allSettled(
      targets.map(async ({ sym, inst }) => {
        const candles = await fetchDayCandles(inst.code, { years: 2 });
        if (candles.length === 0) return null;
        const last = candles[candles.length - 1];
        const prev = candles.length >= 2 ? candles[candles.length - 2] : null;
        const prevClose = prev?.close ?? last.open;
        const change = last.close - prevClose;
        const quote: Quote = {
          symbol: { code: sym.code, exchange: sym.exchange, name: inst.name },
          last: last.close,
          prevClose,
          open: last.open,
          high: last.high,
          low: last.low,
          volume: last.volume,
          amount: 0,
          change,
          changePct: prevClose ? (change / prevClose) * 100 : 0,
          updatedAt: last.timestamp,
        };
        return quote;
      }),
    );

    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) out.push(r.value);
    }
    if (out.length === 0) {
      throw new Error('dukascopy 行情为空');
    }
    return out;
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    const inst = findDukascopyInstrument(params.symbol?.code ?? '');
    if (!inst) return this.unsupported('getKline');

    const mode = mapPeriod(params.period);
    try {
      if (mode === 'minute') {
        const pts = await fetchMinuteCandles(inst.code, new Date());
        return pts.map((c) => ({
          datetime: toIso(c.timestamp),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          amount: 0,
        }));
      }
      const pts = await fetchDayCandles(inst.code, { years: 3 });
      const count = params.count && params.count > 0 ? params.count : 240;
      const sliced = pts.slice(-count);
      return sliced.map((c) => ({
        datetime: toIso(c.timestamp),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        amount: 0,
      }));
    } catch (e) {
      throw new DataSourceError(
        `dukascopy K线失败(${inst.symbolCode})`,
        SOURCE_ID,
        undefined,
        e,
      );
    }
  }
}

register(SOURCE_ID, 'dukascopy(全球指数)', () => new DukascopySource(), true);
