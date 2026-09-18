/**
 * dukascopy 线格式 codec：provider instrument id（如 `usa500idxusd`）。
 * 仅覆盖全球指数白名单（DUKASCOPY_INDEXES）。
 */
import type { AppSymbol } from '@/domain/symbol';
import type { SymbolCodec } from '../../codec';
import {
  DUKASCOPY_INDEXES,
  findDukascopyInstrument,
  type DukascopyInstrument,
} from '../dukascopy/instruments';

function findByInstrumentId(id: string): DukascopyInstrument | null {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return DUKASCOPY_INDEXES.find((it) => it.id.toLowerCase() === key) ?? null;
}

export const dukascopyCodec: SymbolCodec<string> = {
  sourceId: 'dukascopy',
  toSource(symbol: AppSymbol): string | null {
    return findDukascopyInstrument(symbol.code)?.id ?? null;
  },
  fromSource(raw: string, hint?: Partial<AppSymbol>): AppSymbol | null {
    const id = String(raw ?? '').trim();
    const byId = findByInstrumentId(id);
    if (byId) {
      return { code: byId.symbolCode, exchange: byId.exchange, name: byId.name };
    }
    // 允许按 symbolCode / code（USA500.IDX-USD）回查
    const byCode = findDukascopyInstrument(id);
    if (byCode) {
      return { code: byCode.symbolCode, exchange: byCode.exchange, name: byCode.name };
    }
    if (hint?.code && hint.exchange) {
      return { code: hint.code, exchange: hint.exchange, name: hint.name };
    }
    return null;
  },
  covers(symbol: AppSymbol): boolean {
    return findDukascopyInstrument(symbol.code) != null;
  },
};
