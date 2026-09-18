/**
 * domain.symbolKey / parseSymbolKey：App 唯一规范键 CODE.EXCHANGE。
 */
import {
  symbolKey,
  parseSymbolKey,
  normalizeSymbolCode,
  sanitizeSymbol,
  displaySymbol,
} from '@/domain/symbol';

describe('symbolKey', () => {
  it('产出 CODE.EXCHANGE', () => {
    expect(symbolKey({ code: '600519', exchange: 'SH' })).toBe('600519.SH');
    expect(symbolKey({ code: '00700', exchange: 'HK' })).toBe('00700.HK');
    expect(symbolKey({ code: 'AAPL', exchange: 'US' })).toBe('AAPL.US');
    expect(symbolKey({ code: '006342', exchange: 'OF' })).toBe('006342.OF');
  });

  it('禁止/不产出反序键 SH.600519', () => {
    const k = symbolKey({ code: '600519', exchange: 'SH' });
    expect(k).not.toMatch(/^SH\./);
    expect(k).toBe('600519.SH');
  });
});

describe('parseSymbolKey', () => {
  it('roundtrip symbolKey → parseSymbolKey', () => {
    const cases = [
      { code: '600519', exchange: 'SH' as const },
      { code: '000001', exchange: 'SZ' as const },
      { code: '0700', exchange: 'HK' as const },
      { code: 'AAPL', exchange: 'US' as const },
      { code: '886042', exchange: 'TI' as const },
    ];
    for (const s of cases) {
      expect(parseSymbolKey(symbolKey(s))).toEqual({ code: s.code, exchange: s.exchange });
    }
  });

  it('脏输入：sh603986 / 反序 SH.600519', () => {
    expect(parseSymbolKey('sh603986')).toEqual({ code: '603986', exchange: 'SH' });
    expect(parseSymbolKey('SH.600519')).toEqual({ code: '600519', exchange: 'SH' });
    expect(parseSymbolKey('603986.sh')).toEqual({ code: '603986', exchange: 'SH' });
  });
});

describe('normalizeSymbolCode', () => {
  it('反序键归一为 CODE.EXCHANGE', () => {
    expect(normalizeSymbolCode('SH.600519')).toBe('600519.SH');
    expect(normalizeSymbolCode('SZ.000001')).toBe('000001.SZ');
  });

  it('去掉 sh/hk 前缀、后缀大写', () => {
    expect(normalizeSymbolCode('sh603986')).toBe('603986');
    expect(normalizeSymbolCode('HK03986')).toBe('03986');
    expect(normalizeSymbolCode('603986.sh')).toBe('603986.SH');
  });
});

describe('sanitizeSymbol + symbolKey', () => {
  it('脏 code 清洗后键为规范形式', () => {
    const s = sanitizeSymbol({ code: 'sh603986', exchange: 'SH' });
    expect(symbolKey(s)).toBe('603986.SH');
  });

  it('hk 前缀纠偏后键为 HK', () => {
    const s = sanitizeSymbol({ code: 'hk03986', exchange: 'SH' });
    expect(symbolKey(s)).toBe('03986.HK');
  });
});

describe('displaySymbol', () => {
  it('使用规范键展示', () => {
    expect(displaySymbol({ code: '600519', exchange: 'SH' })).toBe('600519.SH');
    expect(displaySymbol({ code: '600519', exchange: 'SH' }, '贵州茅台')).toBe('贵州茅台(600519.SH)');
  });
});
