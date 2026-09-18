/**
 * fund-api 线格式 codec：纯数字基金代码（如 `000001`）。
 * fromSource 恒映射到 exchange=OF。
 */
import type { AppSymbol } from '@/domain/symbol';
import type { SymbolCodec } from '../../codec';

export const fundApiCodec: SymbolCodec<string> = {
  sourceId: 'fund-api',
  toSource(symbol: AppSymbol): string | null {
    if (symbol.exchange !== 'OF') return null;
    const code = String(symbol.code ?? '').trim();
    if (!/^\d+$/.test(code)) return null;
    return code;
  },
  fromSource(raw: string, hint?: Partial<AppSymbol>): AppSymbol | null {
    const code = String(raw ?? '').trim();
    if (!/^\d+$/.test(code)) return null;
    const out: AppSymbol = { code, exchange: 'OF' };
    if (hint?.name) out.name = hint.name;
    return out;
  },
  covers(symbol: AppSymbol): boolean {
    if (symbol.exchange === 'OF') return /^\d+$/.test(String(symbol.code ?? ''));
    return false;
  },
};
