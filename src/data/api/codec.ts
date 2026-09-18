/**
 * SymbolCodec —— 各数据源「App 符号 ↔ 源线格式」转换契约。
 *
 * App 规范符号：`{ code, exchange }` / 字符串键 `CODE.EXCHANGE`（domain.symbolKey）。
 * 每个源持有自己的 codec，出站/入站转换只走 codec，禁止源内私有重复转换器。
 */
import type { AppSymbol } from '@/domain/symbol';

export interface SymbolCodec<TRaw = string> {
  /** 数据源 id，与 MarketDataSource.id 一致 */
  readonly sourceId: string;
  /** App symbol → 源线格式；null = 本源无法寻址该标的 */
  toSource(symbol: AppSymbol): TRaw | null;
  /** 源线格式 → App symbol；hint 可提供 exchange/name 先验；null = 无法映射 */
  fromSource(raw: TRaw, hint?: Partial<AppSymbol>): AppSymbol | null;
  /** 本源是否覆盖该标的 */
  covers(symbol: AppSymbol): boolean;
}

/** codec 是否覆盖全部标的 */
export function codecCoversAll(codec: SymbolCodec, symbols: readonly AppSymbol[]): boolean {
  return symbols.every((s) => codec.covers(s));
}

/** codec 是否覆盖至少一个标的（批量 partition 场景） */
export function codecCoversAny(codec: SymbolCodec, symbols: readonly AppSymbol[]): boolean {
  return symbols.some((s) => codec.covers(s));
}

/** 从批量入参中提取 Symbol / Symbol[]（与 capability.extractSymbols 同语义的轻量版） */
export function extractCodecSymbols(method: string, args: unknown[]): AppSymbol[] {
  const out: AppSymbol[] = [];
  const push = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    const o = v as { code?: unknown; exchange?: unknown; symbol?: unknown; symbols?: unknown };
    if (typeof o.code === 'string' && typeof o.exchange === 'string') {
      out.push({ code: o.code, exchange: o.exchange as AppSymbol['exchange'] });
      return;
    }
    if (o.symbol && typeof o.symbol === 'object') push(o.symbol);
    if (Array.isArray(o.symbols)) o.symbols.forEach(push);
  };
  for (const arg of args) {
    if (Array.isArray(arg)) arg.forEach(push);
    else push(arg);
  }
  // 仅对「参数里确实带 symbol」的方法做 codec 裁剪；无 symbol 的方法返回空
  const SYMBOL_FREE = new Set([
    'search', 'listTickers', 'listIndices', 'getLimitUpPool', 'getLimitUpLadder',
    'getLimitDownPool', 'getLimitBreakPool', 'getAnomalyList', 'getSkyrocketList',
    'getHotStockList', 'getHotStockListHistory', 'getDragonTigerList', 'getTradingDays',
    'isTradingDay', 'nextTradingDay', 'prevTradingDay',
  ]);
  if (SYMBOL_FREE.has(method)) return [];
  return out;
}
