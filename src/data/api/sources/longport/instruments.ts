/**
 * 港美标的 → Longport 代码映射。
 * 本源只处理 exchange=HK / US 的映射表内标的，不碰 A 股。
 */
import type { Symbol } from '../../types';

export interface LongportInstrument {
  /** Longport 代码：700.HK / AAPL.US */
  symbol: string;
  name: string;
  exchange: 'HK' | 'US';
  /** 本项目 Symbol.code */
  symbolCode: string;
  kind: 'index' | 'stock' | 'etf';
}

/** 看板默认港美标的（指数/ETF，OpenAPI 常见代码） */
export const LONGPORT_WATCH: LongportInstrument[] = [
  { symbol: 'HSI.HK', name: '恒生', exchange: 'HK', symbolCode: 'HKG', kind: 'index' },
  { symbol: 'HSTECH.HK', name: '恒生科技', exchange: 'HK', symbolCode: 'HSTECH', kind: 'index' },
  { symbol: 'SPY.US', name: '标普500', exchange: 'US', symbolCode: 'SPY', kind: 'etf' },
  { symbol: 'QQQ.US', name: '纳斯达克', exchange: 'US', symbolCode: 'QQQ', kind: 'etf' },
  { symbol: 'DIA.US', name: '道琼斯', exchange: 'US', symbolCode: 'DIA', kind: 'etf' },
  { symbol: 'AAPL.US', name: '苹果', exchange: 'US', symbolCode: 'AAPL', kind: 'stock' },
  { symbol: 'TSLA.US', name: '特斯拉', exchange: 'US', symbolCode: 'TSLA', kind: 'stock' },
  { symbol: 'NVDA.US', name: '英伟达', exchange: 'US', symbolCode: 'NVDA', kind: 'stock' },
  { symbol: '0700.HK', name: '腾讯', exchange: 'HK', symbolCode: '0700', kind: 'stock' },
  { symbol: '9988.HK', name: '阿里', exchange: 'HK', symbolCode: '9988', kind: 'stock' },
];

const BY_CODE = new Map(LONGPORT_WATCH.map((x) => [x.symbolCode, x]));

/** 自由代码：A 股代码 + HK/US → 长桥格式（5 位港股权重补零） */
export function toLongportSymbol(s: Symbol): string | null {
  const known = BY_CODE.get(s.code);
  if (known) return known.symbol;
  const code = String(s.code ?? '').toUpperCase();
  if (s.exchange === 'HK') {
    const padded = /^\d+$/.test(code) ? code.padStart(5, '0') : code;
    return `${padded}.HK`;
  }
  if (s.exchange === 'US') {
    return code.startsWith('.') || code.includes('.') ? code : `${code}.US`;
  }
  return null;
}

export function findLongportByCode(code: string): LongportInstrument | null {
  return BY_CODE.get(String(code ?? '').toUpperCase()) ?? null;
}
