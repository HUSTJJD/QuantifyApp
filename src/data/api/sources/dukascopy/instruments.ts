/**
 * Dukascopy 标的映射（协议参考 vendor/dukascopy-node）。
 *
 * 本源只覆盖全球指数 / 主要外汇 / 商品，不碰 A 股。
 * 代码格式与 dukascopy instrument-meta-data 一致：id 用于 URL 路径，
 * code（如 USA500.IDX-USD）用于 candles 路径。
 */

export interface DukascopyInstrument {
  /** API path instrument id，如 usa500idxusd */
  id: string;
  /** candles 路径 code，如 USA500.IDX-USD */
  code: string;
  /** 展示名 */
  name: string;
  /** 本项目 Symbol.exchange */
  exchange: 'US' | 'HK';
  /** 本项目 Symbol.code（看板用） */
  symbolCode: string;
  /** 是否按指数展示（影响 UI 标签，不走 isIndexSymbol 规则） */
  kind: 'index' | 'fx' | 'cmd';
}

/** 看板默认全球指数（映射自 dukascopy-node instruments） */
export const DUKASCOPY_INDEXES: DukascopyInstrument[] = [
  {
    id: 'usa500idxusd',
    code: 'USA500.IDX-USD',
    name: '标普500',
    exchange: 'US',
    symbolCode: 'USA500',
    kind: 'index',
  },
  {
    id: 'usatechidxusd',
    code: 'USATECH.IDX-USD',
    name: '纳斯达克',
    exchange: 'US',
    symbolCode: 'USATECH',
    kind: 'index',
  },
  {
    id: 'usa30idxusd',
    code: 'USA30.IDX-USD',
    name: '道琼斯',
    exchange: 'US',
    symbolCode: 'USA30',
    kind: 'index',
  },
  {
    id: 'hkgidxhkd',
    code: 'HKG.IDX-HKD',
    name: '恒生',
    exchange: 'HK',
    symbolCode: 'HKG',
    kind: 'index',
  },
  {
    id: 'jpnidxjpy',
    code: 'JPN.IDX-JPY',
    name: '日经',
    exchange: 'US',
    symbolCode: 'JPN',
    kind: 'index',
  },
  {
    id: 'deuidxeur',
    code: 'DEU.IDX-EUR',
    name: '德国DAX',
    exchange: 'US',
    symbolCode: 'DEU',
    kind: 'index',
  },
  {
    id: 'gbridxgbp',
    code: 'GBR.IDX-GBP',
    name: '英国富时',
    exchange: 'US',
    symbolCode: 'GBR',
    kind: 'index',
  },
  {
    id: 'eusidxeur',
    code: 'EUS.IDX-EUR',
    name: '欧洲斯托克',
    exchange: 'US',
    symbolCode: 'EUS',
    kind: 'index',
  },
];

/** 全量映射：symbolCode → instrument（同 exchange 内唯一） */
const BY_SYMBOL_CODE = new Map<string, DukascopyInstrument>(
  DUKASCOPY_INDEXES.map((it) => [it.symbolCode, it]),
);

export function findDukascopyInstrument(code: string): DukascopyInstrument | null {
  return BY_SYMBOL_CODE.get(String(code ?? '').toUpperCase()) ?? null;
}

export function isDukascopySymbol(code: string): boolean {
  return BY_SYMBOL_CODE.has(String(code ?? '').toUpperCase());
}
