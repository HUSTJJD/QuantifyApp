/**
 * FundApiSource —— 对 npm:fund-api 包的【纯封装】基金数据源。
 *
 * 设计原则（与 StockApiSource 同构，遵循“通用行情源 API 封装”诉求）：
 *  - 只薄薄包一层 fund-api 的 `funds.auto`（auto 按运行环境自动选 best provider），
 *    不掺杂任何直连 HTTP / 手写格式转换等额外逻辑；
 *  - fund-api 库内部已统一处理基金代码（纯数字 code）、字段归一化，
 *    本类仅做「库返回结构 -> 本项目统一类型」的映射，差异消化在 source 内部；
 *  - 库不支持或返回空时，抛出 DataSourceError(3004)，
 *    交由 MarketDataClient 路由到其它兜底源；
 *  - 本源仅覆盖基金能力：净值快照(getFundMarketSnapshot) / 档案(getFundProfile) /
 *    历史净值(getFundNav / getFundHistorical) / 搜索(search)；
 *    持仓/收益/持有人等库不支持的能力继承自 BaseMarketDataSource 抛 3004。
 *
 * ⚠️ fund-api 客观限制：getNavHistory 不接收 period/count 参数，返回全量历史净值；
 *   本源在 getFundHistorical 中按 [startMs, endMs] 自行过滤。
 */
import fundApi from 'fund-api';
import { BaseMarketDataSource } from './BaseMarketDataSource';
import { register } from '../DataSourceRegistry';
import type {
  Symbol as UnifiedSymbol,
  Quote,
  Candle,
  FundType,
  FundProfile,
  FundNav,
  Instrument,
  SearchParams,
} from '../types';

const SOURCE_ID = 'fund-api';

/** 本项目 Symbol -> fund-api 库 code（纯数字基金代码，如 000001） */
function toProviderCode(symbol: UnifiedSymbol): string {
  return symbol.code;
}

/** fund-api 返回的 code（如 000001）-> 本项目统一 Symbol（基金统一归 OF 市场） */
function fromProviderCode(code: string): UnifiedSymbol {
  return { code, exchange: 'OF' };
}

interface FundApiFund {
  code: string;
  name?: string;
  nav?: number;
  accNav?: number;
  change?: number;
  navDate?: string;
  source?: string;
}
interface FundApiNavItem {
  date: string;
  nav: number;
  accNav?: number;
  source?: string;
}

const auto = fundApi.funds.auto;

export class FundApiSource extends BaseMarketDataSource {
  readonly id = SOURCE_ID;
  readonly label = 'fund-api(npm:fund-api)';
  private initialized = false;

  async init(): Promise<void> {
    this.initialized = true;
  }
  async dispose(): Promise<void> {
    this.initialized = false;
  }

  /** 基金净值快照：透传 getFund，映射到统一 Quote（以最新净值作为 last） */
  async getFundMarketSnapshot(symbol: UnifiedSymbol): Promise<Quote> {
    const raw = (await auto.getFund(toProviderCode(symbol))) as FundApiFund;
    if (!raw || !raw.code) {
      return this.unsupported(`getFundMarketSnapshot(${symbol.code})`);
    }
    return {
      symbol: fromProviderCode(raw.code),
      last: raw.nav ?? 0,
      prevClose: raw.accNav ?? 0,
      open: 0,
      high: 0,
      low: 0,
      volume: 0,
      amount: 0,
      changePct: raw.change != null ? raw.change * 100 : undefined,
      updatedAt: raw.navDate ? new Date(raw.navDate).getTime() : Date.now(),
    };
  }

  /** 基金档案：透传 getFund，映射到统一 FundProfile（库仅含名称/净值，其余字段留 null） */
  async getFundProfile(symbol: UnifiedSymbol, _type: FundType): Promise<FundProfile> {
    const raw = (await auto.getFund(toProviderCode(symbol))) as FundApiFund;
    if (!raw || !raw.code) {
      return this.unsupported(`getFundProfile(${symbol.code})`);
    }
    return {
      symbol: fromProviderCode(raw.code),
      ticker: raw.code,
      fundName: raw.name ?? null,
      estabDateMs: null,
      mgmtName: null,
      managerName: null,
    };
  }

  /** 历史净值：透传 getNavHistory，映射到统一 FundNav[]（全量，由调用方按需过滤） */
  async getFundNav(
    symbol: UnifiedSymbol,
    _type: FundType,
    _report?: string,
    _market?: string,
  ): Promise<FundNav[]> {
    const items = (await auto.getNavHistory(toProviderCode(symbol))) as FundApiNavItem[];
    if (!items || items.length === 0) {
      return this.unsupported(`getFundNav(${symbol.code})`);
    }
    return items.map((it) => ({
      symbol: fromProviderCode(symbol.code),
      navDate: it.date,
      unitNav: it.nav ?? null,
      adjNav: it.accNav ?? null,
    }));
  }

  /** 区间历史净值：透传 getNavHistory 后按 [startMs, endMs] 过滤，映射到统一 Candle[] */
  async getFundHistorical(symbol: UnifiedSymbol, startMs: number, endMs: number): Promise<Candle[]> {
    const items = (await auto.getNavHistory(toProviderCode(symbol))) as FundApiNavItem[];
    if (!items || items.length === 0) {
      return this.unsupported(`getFundHistorical(${symbol.code})`);
    }
    const candles = items
      .filter((it) => {
        const t = new Date(it.date).getTime();
        return t >= startMs && t <= endMs;
      })
      .map((it) => ({
        datetime: it.date,
        open: it.nav,
        high: it.nav,
        low: it.nav,
        close: it.nav,
        volume: 0,
        amount: it.accNav,
      }));
    if (candles.length === 0) {
      // 区间内无数据：本源取不到，抛 3004 让兜底源尝试
      return this.unsupported(`getFundHistorical(${symbol.code}) empty in range`);
    }
    return candles;
  }

  /** 基金搜索：透传 searchFunds，映射到统一 Instrument */
  async search(params: SearchParams): Promise<Instrument[]> {
    const list = (await auto.searchFunds(params.keyword)) as Array<{
      code: string;
      name: string;
      type?: string;
    }>;
    const arr = Array.isArray(list) ? list : [];
    const limited = params.limit ? arr.slice(0, params.limit) : arr;
    return limited.map((s) => ({
      symbol: fromProviderCode(s.code),
      name: s.name ?? '',
      market: 'A',
    }));
  }
}

// 自注册到数据源注册表（与 StockSdkSource / HithsaApiSource 同构）
register(SOURCE_ID, 'fund-api(npm:fund-api)', () => new FundApiSource(), true);
