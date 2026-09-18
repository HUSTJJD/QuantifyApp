/**
 * stock-sdk 线格式 codec：裸代码 `600519` + 市场命名空间（cn/hk/us/fund）。
 *
 * 覆盖：SH / SZ / BJ / HK / US / OF / EM 板块（BKxxxx）。
 * fromSource 优先用 hint.exchange，否则按代码启发式推断。
 */
import type { AppSymbol } from '@/domain/symbol';
import type { SymbolCodec } from '../../codec';
import type { Exchange } from '../../types';

export type SdkMarketNamespace = 'cn' | 'hk' | 'us' | 'fund';

/** 覆盖的交易所集合 */
const COVERED: ReadonlySet<Exchange> = new Set<Exchange>(['SH', 'SZ', 'BJ', 'HK', 'US', 'OF', 'EM']);

/** App symbol → stock-sdk 裸代码（如 600519 / 00700 / BK1027） */
export function toSdkCode(symbol: AppSymbol): string {
  return String(symbol.code ?? '').replace(/\.[A-Z]{2}$/i, '');
}

/** App symbol → stock-sdk 市场命名空间 */
export function marketNamespace(symbol: AppSymbol): SdkMarketNamespace {
  if (symbol.exchange === 'HK') return 'hk';
  if (symbol.exchange === 'US') return 'us';
  if (symbol.exchange === 'OF') return 'fund';
  return 'cn';
}

/**
 * 裸代码 + 市场提示 → Exchange。
 * market 大小写不敏感：HK / US / CN；代码带 sh/sz/hk 前缀时前缀优先。
 */
export function exchangeOf(market: string, code: string): Exchange {
  const m = String(market ?? '').toUpperCase();
  if (m === 'HK') return 'HK';
  if (m === 'US') return 'US';
  const c = String(code ?? '').toLowerCase();
  if (c.startsWith('hk')) return 'HK';
  if (c.startsWith('us')) return 'US';
  if (c.startsWith('sh')) return 'SH';
  if (c.startsWith('sz')) return 'SZ';
  if (c.startsWith('bj')) return 'BJ';
  if (c.startsWith('bk')) return 'EM';
  // A 股按代码首位推断
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('0') || code.startsWith('3')) return 'SZ';
  if (code.startsWith('8') || code.startsWith('4') || code.startsWith('92')) return 'BJ';
  return 'SH';
}

/** 线格式 → App symbol；hint.exchange 优先于启发式 */
function fromSdkCode(raw: string, hint?: Partial<AppSymbol>): AppSymbol | null {
  let code = String(raw ?? '').trim();
  if (!code) return null;
  let forced: Exchange | null = hint?.exchange ?? null;
  const pref = code.match(/^(sh|sz|bj|hk|us)(?=\d|[a-z])/i);
  if (pref) {
    const p = pref[1]!.toLowerCase();
    code = code.slice(pref[0].length);
    forced =
      p === 'sh' ? 'SH' : p === 'sz' ? 'SZ' : p === 'bj' ? 'BJ' : p === 'hk' ? 'HK' : 'US';
  }
  // 已带 .XX 后缀
  const suf = code.match(/^([^.]+)\.([A-Za-z]{2})$/);
  if (suf) {
    code = suf[1]!;
    if (!forced) forced = exchangeOf(suf[2]!, code);
  }
  const exchange = forced ?? exchangeOf(hint && 'exchange' in hint ? String(hint.exchange) : 'CN', code);
  const out: AppSymbol = { code, exchange };
  if (hint?.name) out.name = hint.name;
  return out;
}

export const stockSdkCodec: SymbolCodec<string> = {
  sourceId: 'stock-sdk',
  toSource: (symbol) => (COVERED.has(symbol.exchange) ? toSdkCode(symbol) : null),
  fromSource: fromSdkCode,
  covers: (symbol) => COVERED.has(symbol.exchange),
};
