/**
 * longport（长桥 OpenAPI）线格式 codec：`700.HK` / `AAPL.US`。
 * 仅覆盖 HK/US；映射逻辑吸收自 longport/instruments.ts 的 LONGPORT_WATCH。
 */
import type { AppSymbol } from '@/domain/symbol';
import type { SymbolCodec } from '../../codec';
import { LONGPORT_WATCH, toLongportSymbol, findLongportByCode } from '../longport/instruments';

export const longportCodec: SymbolCodec<string> = {
  sourceId: 'longport',
  toSource(symbol: AppSymbol): string | null {
    if (symbol.exchange !== 'HK' && symbol.exchange !== 'US') return null;
    return toLongportSymbol(symbol);
  },
  fromSource(raw: string, hint?: Partial<AppSymbol>): AppSymbol | null {
    const s = String(raw ?? '').trim().toUpperCase();
    if (!s) return null;
    const known = LONGPORT_WATCH.find((x) => x.symbol.toUpperCase() === s);
    if (known) {
      return { code: known.symbolCode, exchange: known.exchange, name: known.name };
    }
    // AAPL.US / 700.HK
    const m = s.match(/^([A-Z0-9]+)\.(HK|US)$/);
    if (!m) return null;
    const exchange = m[2] as 'HK' | 'US';
    let code = m[1]!;
    if (exchange === 'HK' && /^\d+$/.test(code)) {
      // 长桥 HK 数字码常见 4~5 位；与看板 symbolCode 对齐（0700）
      const byCode = findLongportByCode(code) ?? findLongportByCode(code.padStart(4, '0'));
      if (byCode) code = byCode.symbolCode;
      else code = code.padStart(4, '0');
    }
    const out: AppSymbol = { code, exchange };
    if (hint?.name) out.name = hint.name;
    return out;
  },
  covers(symbol: AppSymbol): boolean {
    return (symbol.exchange === 'HK' || symbol.exchange === 'US') && toLongportSymbol(symbol) != null;
  },
};
