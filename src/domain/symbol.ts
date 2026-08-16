/**
 * 标的标识领域工具：代码↔统一 Symbol 互转、市场归类。
 * 集中处理交易所后缀，避免散落在各数据源里。
 */
import type { Exchange, Market, Symbol } from '@/api';

const EXCHANGE_SUFFIX: Record<Exchange, string> = {
  SH: '.SH',
  SZ: '.SZ',
  BJ: '.BJ',
  HK: '.HK',
  TI: '.TI',
  OF: '.OF',
  US: '.US',
};

/**
 * 同花顺官方服务（hithink-finance skill）接受的 thscode 后缀白名单。
 * 参考 references/api/capability-map.md：
 *   thscode 必须带交易所后缀（.SH / .SZ / .BJ / .TI），纯 6 位代码不被接受。
 * 注意：港股(.HK)/美股不在官方覆盖范围内（skill 能力边界“超出范围”），
 * 其 thscode 不应进入同花顺官方源，否则服务端判“标的代码不支持”。
 */
const THS_SUPPORTED_SUFFIX: ReadonlySet<Exchange> = new Set<Exchange>(['SH', 'SZ', 'BJ', 'TI', 'OF']);

const SUFFIX_TO_EXCHANGE: Record<string, Exchange> = {
  SH: 'SH',
  SZ: 'SZ',
  BJ: 'BJ',
  HK: 'HK',
};

/** 把 600519.SH / 00700.HK 这样的完整代码解析成 Symbol */
export function parseSymbol(fullCode: string): Symbol {
  const m = fullCode.match(/^(\d+)\.([A-Z]{2})$/);
  if (m) {
    return { code: m[1], exchange: SUFFIX_TO_EXCHANGE[m[2]] ?? 'SH' };
  }
  // 没有后缀则按规则推断
  return inferSymbol(fullCode);
}

/** 根据代码特征推断交易所 */
export function inferSymbol(code: string): Symbol {
  if (/^\d{5}$/.test(code)) return { code, exchange: 'HK' };
  if (code.startsWith('6')) return { code, exchange: 'SH' };
  if (code.startsWith('0') || code.startsWith('3')) return { code, exchange: 'SZ' };
  if (code.startsWith('8') || code.startsWith('4')) return { code, exchange: 'BJ' };
  return { code, exchange: 'SH' };
}

/** Symbol -> 完整代码字符串 */
export function toFullCode(symbol: Symbol): string {
  return `${symbol.code}${EXCHANGE_SUFFIX[symbol.exchange] ?? ''}`;
}

/** Symbol -> 展示文本，例如 600519.SH 贵州茅台 */
export function displaySymbol(symbol: Symbol, name?: string): string {
  const code = toFullCode(symbol);
  return name ? `${name}(${code})` : code;
}

/** 交易所 -> 市场大类 */
export function marketOf(exchange: Exchange): Market {
  if (exchange === 'HK') return 'HK';
  return 'A';
}

/**
 * 本项目 Symbol -> 同花顺 thscode（如 600519.SH / 886042.TI / 025480.OF）。
 *
 * 严格遵循 skill 契约：thscode 必须带交易所后缀（.SH/.SZ/.BJ/.TI/.OF），
 * 纯 6 位代码不被接受；且港股(.HK)/美股等超出官方覆盖范围。
 *
 * 规范化规则：
 *  1. 若 code 已带合法后缀（如 600519.SH），不再重复拼接，避免 600519.SH.SH；
 *  2. 若 exchange 后缀不在官方白名单（如 HK），抛错，避免构造出契约外的 .HK
 *     被官方源判为“标的代码不支持”（港股应走第三方兜底源）。
 */
export function toThsCode(symbol: Symbol): string {
  const { code, exchange } = symbol;
  // 1) 已带后缀：如 600519.SH / 00700.HK —— 直接使用，去掉多余后缀拼接
  const m = code.match(/^([^.]+)\.([A-Z]{2})$/);
  if (m) {
    const ex = m[2] as Exchange;
    if (!THS_SUPPORTED_SUFFIX.has(ex)) {
      throw new Error(
        `toThsCode: 标的 ${code} 的后缀 .${ex} 不在同花顺官方支持范围（.SH/.SZ/.BJ/.TI/.OF），` +
          `港股/美股等应走第三方兜底源`,
      );
    }
    return code;
  }
  // 2) 纯代码：按 exchange 拼接官方后缀
  if (!THS_SUPPORTED_SUFFIX.has(exchange)) {
    throw new Error(
      `toThsCode: 交易所 ${exchange} 不在同花顺官方支持范围（.SH/.SZ/.BJ/.TI/.OF），` +
        `标的 ${code} 应走第三方兜底源`,
    );
  }
  return `${code}${EXCHANGE_SUFFIX[exchange]}`;
}

/** 同花顺 thscode -> 本项目 Symbol */
export function fromThsCode(thsCode: string): Symbol {
  const m = thsCode.match(/^([^.]+)\.([A-Z]{2})$/);
  if (m) {
    return { code: m[1], exchange: m[2] as Exchange };
  }
  return { code: thsCode, exchange: 'SH' };
}
