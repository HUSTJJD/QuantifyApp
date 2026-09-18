/**
 * LongportSource —— 港美行情源（长桥 OpenAPI HTTP）。
 *
 * npm `longbridge` 为 Node 原生扩展，RN 不可用；本源用 HTTP + HMAC 签名对接同一 OpenAPI。
 * 凭证缺失时 supports() 返回 false，路由自动回落 dukascopy / stock-sdk。
 */
import { BaseMarketDataSource } from './BaseMarketDataSource';
import { DataSourceError } from '../MarketDataSource';
import { register } from '../DataSourceRegistry';
import type { DataSourceMethod, MethodArgs } from '../MarketDataSource';
import type { SymbolCodec } from '../codec';
import { storage, StorageKeys } from '@/data/db/storage';
import type { Candle, Instrument, KlinePeriod, KlineParams, Quote, SearchParams, Symbol } from '../types';
import {
  fetchLongportCandles,
  fetchLongportQuotes,
  hasLongportCreds,
  type LongportCredentials,
} from './longport/client';
import { LONGPORT_WATCH } from './longport/instruments';
import { longportCodec } from './codecs/longportCodec';

const SOURCE_ID = 'longport';

/**
 * 默认凭证：来自上层 `hkus/hkus/config/config.yaml`（长桥 paper 账户）。
 * 优先级：设置页存储 > 环境变量 > 此默认值。
 */
export const DEFAULT_LONGPORT_CREDS: LongportCredentials = {
  appKey: '388ed41518d9b27ac1f465ac08a69e29',
  appSecret: 'ffb50b35d4bded6874541b6e5c616b482d6f8570ec69b61ef3162035a4f4b323',
  accessToken:
    'm_eyJhbGciOiJSUzI1NiIsImtpZCI6ImQ5YWRiMGIxYTdlNzYxNzEiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJsb25nYnJpZGdlIiwic3ViIjoiYWNjZXNzX3Rva2VuIiwiZXhwIjoxNzg0NTU1NDg2LCJpYXQiOjE3NzY3Nzk0ODYsImFrIjoiMzg4ZWQ0MTUxOGQ5YjI3YWMxZjQ2NWFjMDhhNjllMjkiLCJhYWlkIjoyMDcxMzUxNywiYWMiOiJsYl9wYXBlcnRyYWRpbmciLCJtaWQiOjE2NzA1ODEzLCJzaWQiOiIrWDhNclloTkJ5dmhuSThlTmNncUVBPT0iLCJibCI6MywidWwiOjAsImlrIjoibGJfcGFwZXJ0cmFkaW5nXzIwNzEzNTE3In0.QP2n3hG7mCYGTXHheLfRMwslG4NejclpofCTBuhFxUA3bGbKWQrW_ebr7FSrVRwGCDWcF3APNz5ShPMfqYlRItyTex3uCCkUVrt_w3-81Y-t0zFzYuRZydPUyVp8j4L5bfkzVAUB2Lme50IM1XuEl11g4xysJZdVwLKSO9n78gErysXSPlggzwZZxN5e1piLM66_72-ONRACZz2aC62hWal35bF03B1eMeEmTtJt5ae43axcXaSnhgxTlvadK9n0wCqgVw7zZFzYZjjghzSpiT7pg-8_RiZble9C4Z15e9sewuVI1YqyYQqa38BIpJN3j0Dr09jtY-dfPeohaxNwxEOn0i99IOrdnI1JzhmjnOM99rMZNJWfr1BOgwJeDwHW-djaj__6CXXkmoot7M4Zwx71MpY2wi5Y-1FLa-azcKQ5xRMkHAySmgITM8rxP1KDGlbz1YTSYtWoDBwIp_gqCEXTb0GRFpZJFcN7Yw-Zxhuw8mtt7J_3ctSe89VXv-ng1AQjhIWaSCMOnwEV21fI3YNe4KrCjtTQ2mCfTh5Kp6GO2NyP4Iq7URud3m9xjDE2Vq8R2Ymw64cyeLXFwlI8zvFz9_xE0354wUn7NUzF6TTeTGsFRSZn6bLpcSV9fZ1d6Mkd8JmL96aXE-FmFvmNAMgaCOBUwDFKDuia2-Su2Ww',
};

/** 运行时凭证（设置页 / 环境变量 / 默认） */
let memCreds: LongportCredentials | null = null;

export function setLongportCreds(cred: LongportCredentials | null): void {
  memCreds = cred;
  const key = `${StorageKeys.API_KEY}.longport`;
  if (cred) {
    storage.setObject(key, cred).catch(() => undefined);
  } else {
    storage.remove(key).catch(() => undefined);
  }
}

export async function loadLongportCreds(): Promise<LongportCredentials | null> {
  if (memCreds) return memCreds;
  try {
    const saved = await storage.getObject<LongportCredentials>(`${StorageKeys.API_KEY}.longport`);
    if (hasLongportCreds(saved)) {
      memCreds = saved;
      return saved;
    }
  } catch {
    // ignore
  }
  const env = {
    appKey: process.env?.LONGBRIDGE_APP_KEY ?? process.env?.LONGPORT_APP_KEY ?? '',
    appSecret: process.env?.LONGBRIDGE_APP_SECRET ?? process.env?.LONGPORT_APP_SECRET ?? '',
    accessToken: process.env?.LONGBRIDGE_ACCESS_TOKEN ?? process.env?.LONGPORT_ACCESS_TOKEN ?? '',
  };
  if (hasLongportCreds(env)) {
    memCreds = env;
    return env;
  }
  // 默认：上层 hkus/config/config.yaml 的 paper 凭证
  if (hasLongportCreds(DEFAULT_LONGPORT_CREDS)) {
    memCreds = DEFAULT_LONGPORT_CREDS;
    return memCreds;
  }
  return null;
}

function mapPeriod(period: KlinePeriod | undefined): string {
  switch (period) {
    case '1m': return '1m';
    case '5m': return '5m';
    case '15m': return '15m';
    case '30m': return '30m';
    case '60m': return '60m';
    case 'week': return '1w';
    case 'month': return '1M';
    default: return '1d';
  }
}

function isHkUs(s: Symbol): boolean {
  return s.exchange === 'HK' || s.exchange === 'US';
}

export class LongportSource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'longport(长桥 OpenAPI)';
  /** 700.HK / AAPL.US 线格式 codec */
  readonly codec: SymbolCodec = longportCodec;

  readonly capabilities: ReadonlySet<DataSourceMethod> = new Set([
    'getQuotes',
    'getKline',
    'search',
  ]);

  private cred: LongportCredentials | null = null;

  async init(): Promise<void> {
    this.cred = await loadLongportCreds();
  }

  async dispose(): Promise<void> {
    this.cred = null;
  }

  private async requireCreds(): Promise<LongportCredentials> {
    if (this.cred) return this.cred;
    this.cred = await loadLongportCreds();
    if (!this.cred) {
      throw new DataSourceError('longport 未配置凭证', SOURCE_ID, 3004);
    }
    return this.cred;
  }

  override supports<M extends DataSourceMethod>(method: M, args: MethodArgs<M>): boolean {
    if (!memCreds) {
      // 惰性：内存无凭证时仍允许尝试（init 已加载）；supports 需同步，无凭证直接 false
      // 若 init 未跑完，首次 invoke 会 init
    }
    const credOk = !!memCreds;
    if (!credOk) return false;
    const a = args as unknown[];
    if (method === 'search') return true;
    if (method === 'getQuotes') {
      const raw = a[0];
      const list = Array.isArray(raw) ? (raw as Symbol[]) : raw ? [raw as Symbol] : [];
      return list.some((s) => isHkUs(s) && this.codec.covers(s));
    }
    if (method === 'getKline') {
      const p = a[0] as { symbol?: Symbol } | undefined;
      return !!(p?.symbol && isHkUs(p.symbol) && this.codec.covers(p.symbol));
    }
    return false;
  }

  async search(params: SearchParams): Promise<Instrument[]> {
    const kw = String(params?.keyword ?? '').trim().toLowerCase();
    if (!kw) return [];
    return LONGPORT_WATCH.filter(
      (it) => it.name.toLowerCase().includes(kw) || it.symbol.toLowerCase().includes(kw),
    ).map((it) => ({
      symbol: { code: it.symbolCode, exchange: it.exchange, name: it.name },
      name: it.name,
      market: it.exchange === 'HK' ? ('HK' as const) : ('US' as const),
    }));
  }

  async getQuotes(symbols: Symbol[]): Promise<Quote[]> {
    const cred = await this.requireCreds();
    const mapped = symbols
      .map((s) => ({ s, lp: this.codec.toSource(s) }))
      .filter((x): x is { s: Symbol; lp: string } => !!x.lp && isHkUs(x.s));
    if (mapped.length === 0) return this.unsupported('getQuotes');
    const lpSymbols = mapped.map((x) => x.lp);
    let quotes;
    try {
      quotes = await fetchLongportQuotes(cred, lpSymbols);
    } catch (e) {
      throw new DataSourceError('longport 行情失败', SOURCE_ID, undefined, e);
    }
    const byLp = new Map(quotes.map((q) => [q.symbol, q]));
    const out: Quote[] = [];
    for (const { s, lp } of mapped) {
      const q = byLp.get(lp);
      if (!q || q.lastDone <= 0) continue;
      out.push({
        symbol: { code: s.code, exchange: s.exchange, name: s.name },
        last: q.lastDone,
        prevClose: q.prevClose,
        open: q.open,
        high: q.high,
        low: q.low,
        volume: q.volume,
        amount: q.turnover,
        change: q.change ?? q.lastDone - q.prevClose,
        changePct: q.changePct ?? (q.prevClose ? ((q.lastDone - q.prevClose) / q.prevClose) * 100 : 0),
        updatedAt: q.updatedAtMs,
      });
    }
    if (out.length === 0) throw new Error('longport 行情为空');
    return out;
  }

  async getKline(params: KlineParams): Promise<Candle[]> {
    const cred = await this.requireCreds();
    const lp = this.codec.toSource(params.symbol);
    if (!lp || !isHkUs(params.symbol)) return this.unsupported('getKline');
    const count = params.count && params.count > 0 ? params.count : 200;
    try {
      const bars = await fetchLongportCandles(cred, lp, mapPeriod(params.period), count);
      return bars.map((b) => ({
        datetime: new Date(b.timestampMs).toISOString(),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
        amount: b.turnover,
      }));
    } catch (e) {
      throw new DataSourceError(`longport K线失败(${lp})`, SOURCE_ID, undefined, e);
    }
  }
}

register(SOURCE_ID, 'longport(港美)', () => new LongportSource(), true);

// 启动时预加载凭证（含默认 paper），保证 supports() 能同步判定
memCreds = DEFAULT_LONGPORT_CREDS;
loadLongportCreds().catch(() => undefined);
