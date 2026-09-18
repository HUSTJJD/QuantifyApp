/**
 * fuyao（同花顺官方 SDK）线格式 codec：thscode `600519.SH`。
 *
 * 覆盖：SH / SZ / BJ / TI / OF（官方 skill 能力边界）。
 * 不覆盖：HK / US / EM 板块（东财 BKxxxx 无 thscode）。
 */
import type { AppSymbol } from '@/domain/symbol';
import { isEmBoardCode, parseSymbolKey } from '@/domain/symbol';
import type { SymbolCodec } from '../../codec';
import type { Exchange } from '../../types';

/** 同花顺官方 thscode 后缀白名单 */
const THS_SUPPORTED_SUFFIX: ReadonlySet<Exchange> = new Set<Exchange>(['SH', 'SZ', 'BJ', 'TI', 'OF']);

/** App symbol → thscode；不可寻址返回 null */
function toThsCodeOrNull(symbol: AppSymbol): string | null {
  const { code, exchange } = symbol;
  if (exchange === 'EM' || isEmBoardCode(code)) return null;
  // 已带后缀：校验白名单，避免 600519.SH.SH
  const m = code.match(/^([^.]+)\.([A-Z]{2})$/);
  if (m) {
    const ex = m[2] as Exchange;
    if (!THS_SUPPORTED_SUFFIX.has(ex)) return null;
    return code;
  }
  if (!THS_SUPPORTED_SUFFIX.has(exchange)) return null;
  return `${code}.${exchange}`;
}

/**
 * 严格转换：不可寻址时抛错（调用方语义 = 应路由到第三方源）。
 * 从 domain 迁入；thscode 是 fuyao 源专属线格式，不是 App 领域概念。
 */
export function toThsCode(symbol: AppSymbol): string {
  const ths = toThsCodeOrNull(symbol);
  if (!ths) {
    const { code, exchange } = symbol;
    if (exchange === 'EM' || isEmBoardCode(code)) {
      throw new Error(
        `toThsCode: 东方财富板块 ${code} 无同花顺 thscode，应走 stock-sdk board.*`,
      );
    }
    throw new Error(
      `toThsCode: 交易所 ${exchange} 不在同花顺官方支持范围（.SH/.SZ/.BJ/.TI/.OF），` +
        `标的 ${code} 应走第三方兜底源`,
    );
  }
  return ths;
}

/** thscode → App symbol */
export function fromThsCode(thsCode: string): AppSymbol {
  return parseSymbolKey(thsCode);
}

export const fuyaoCodec: SymbolCodec<string> = {
  sourceId: 'fuyao',
  toSource: toThsCodeOrNull,
  fromSource(raw: string): AppSymbol | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    const parsed = fromThsCode(s);
    // 反序列化时若后缀不在白名单（如 .HK 误入），判为不可映射
    if (!THS_SUPPORTED_SUFFIX.has(parsed.exchange) && !parsed.code.includes('.')) {
      // 裸码按 parse 推断的交易所再校验
      return THS_SUPPORTED_SUFFIX.has(parsed.exchange) ? parsed : null;
    }
    if (parsed.code.includes('.')) {
      // parseSymbolKey 已拆开；exchange 不在白名单则 null
      return THS_SUPPORTED_SUFFIX.has(parsed.exchange) ? parsed : null;
    }
    return THS_SUPPORTED_SUFFIX.has(parsed.exchange) ? parsed : null;
  },
  covers(symbol: AppSymbol): boolean {
    return toThsCodeOrNull(symbol) != null;
  },
};
