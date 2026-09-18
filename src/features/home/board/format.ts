/**
 * 看板共享格式化与指数常量。
 */
import type { Quote, Symbol } from '@/data/api';
import { symbolKey } from '@/domain';

/** 涨跌幅文本：始终带符号，负号用 ASCII 便于 tabular 对齐 */
export function fmtPct(pct: number | null | undefined, digits = 2): string {
  if (pct == null || !Number.isFinite(pct)) return '--';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(digits)}%`;
}

export function fmtPrice(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '--';
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  return v.toFixed(digits);
}

export function fmtIndexPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '--';
  if (v >= 10000) return v.toFixed(0);
  return v.toFixed(2);
}

export function quotePct(q?: Quote | null): number {
  if (!q) return 0;
  if (q.changePct != null && Number.isFinite(q.changePct)) return q.changePct;
  if (q.prevClose) return ((q.last - q.prevClose) / q.prevClose) * 100;
  return 0;
}

export function quoteChange(q?: Quote | null): number {
  if (!q) return 0;
  if (q.change != null && Number.isFinite(q.change)) return q.change;
  return q.last - q.prevClose;
}

export function fmtYi(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const yi = v / 1e8;
  const abs = Math.abs(yi);
  if (abs >= 10000) return `${(yi / 10000).toFixed(2)}万亿`;
  if (abs < 0.01) return `${(v / 1e4).toFixed(0)}万`;
  return `${yi >= 0 ? '+' : ''}${yi.toFixed(2)}亿`;
}

export function quoteKey(q: Quote): string {
  return symbolKey(q.symbol);
}

/** A 股大盘指数（ChinaBoard 主网格） */
export const CN_BOARD_INDICES: Symbol[] = [
  { code: '000001', exchange: 'SH', name: '上证指数' },
  { code: '399001', exchange: 'SZ', name: '深证成指' },
  { code: '399006', exchange: 'SZ', name: '创业板指' },
  { code: '899050', exchange: 'BJ', name: '北证50' },
  { code: '000688', exchange: 'SH', name: '科创50' },
];

/**
 * 全球条标的。港美指数走 dukascopy 源（见 sources/dukascopy/instruments），
 * 失败时 UI 显示 `--`，不阻塞 A 股数据。
 */
export const GLOBAL_TICKER_INDICES: Array<{ symbol: Symbol; short: string; market: 'CN' | 'HK' | 'US' }> = [
  { symbol: { code: '000001', exchange: 'SH', name: '上证指数' }, short: '上证', market: 'CN' },
  { symbol: { code: '399001', exchange: 'SZ', name: '深证成指' }, short: '深成', market: 'CN' },
  { symbol: { code: '399006', exchange: 'SZ', name: '创业板指' }, short: '创业板', market: 'CN' },
  { symbol: { code: 'HKG', exchange: 'HK', name: '恒生' }, short: '恒生', market: 'HK' },
  { symbol: { code: 'SPY', exchange: 'US', name: '标普500' }, short: '标普', market: 'US' },
  { symbol: { code: 'QQQ', exchange: 'US', name: '纳斯达克' }, short: '纳指', market: 'US' },
  { symbol: { code: 'DIA', exchange: 'US', name: '道琼斯' }, short: '道指', market: 'US' },
  { symbol: { code: 'AAPL', exchange: 'US', name: '苹果' }, short: '苹果', market: 'US' },
  { symbol: { code: 'NVDA', exchange: 'US', name: '英伟达' }, short: 'NVDA', market: 'US' },
];

export const GLOBAL_SYMBOLS: Symbol[] = GLOBAL_TICKER_INDICES.map((g) => g.symbol);

/** 主板全部指数（全球条 + 中国大盘额外项），一次拉取共享 */
export const ALL_BOARD_SYMBOLS: Symbol[] = (() => {
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const s of [...GLOBAL_SYMBOLS, ...CN_BOARD_INDICES]) {
    const k = symbolKey(s);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(s);
    }
  }
  return out;
})();

export function fullCodeOf(symbol: Symbol): string {
  return symbolKey(symbol);
}

/** 按 code.exchange 去重，保留首次出现（异动/热股/资金流列表可能重复同一标的） */
export function dedupeByFullCode<T extends { symbol: Symbol }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = fullCodeOf(it.symbol);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
