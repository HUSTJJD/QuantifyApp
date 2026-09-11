/**
 * domain/symbol 清洗：脏 code 前缀纠偏。
 */
import {
  parseSymbol,
  sanitizeSymbol,
  normalizeSymbolCode,
  toThsCode,
  isFundSymbol,
  isOptionCode,
  isBondCode,
  isListedFundCode,
  isNonKlineSymbol,
} from '@/domain/symbol';

describe('normalizeSymbolCode', () => {
  it('去掉 sh/hk 前缀', () => {
    expect(normalizeSymbolCode('sh603986')).toBe('603986');
    expect(normalizeSymbolCode('HK03986')).toBe('03986');
    expect(normalizeSymbolCode('sh.600519')).toBe('600519');
  });

  it('后缀大写化', () => {
    expect(normalizeSymbolCode('603986.sh')).toBe('603986.SH');
  });
});

describe('sanitizeSymbol', () => {
  it('code 混入 sh 前缀 → 纯代码 + SH', () => {
    expect(sanitizeSymbol({ code: 'sh603986', exchange: 'SH' })).toEqual({
      code: '603986',
      exchange: 'SH',
    });
  });

  it('hk 前缀优先于错误的 SH 后缀', () => {
    expect(sanitizeSymbol({ code: 'hk03986', exchange: 'SH' })).toEqual({
      code: '03986',
      exchange: 'HK',
    });
  });

  it('code 已带 .SH 后缀时去掉重复后缀', () => {
    expect(sanitizeSymbol({ code: '600519.SH', exchange: 'SH' })).toEqual({
      code: '600519',
      exchange: 'SH',
    });
  });

  it('合法 code 不变，且保留 name', () => {
    expect(sanitizeSymbol({ code: '000858', exchange: 'SZ', name: '五粮液' })).toEqual({
      code: '000858',
      exchange: 'SZ',
      name: '五粮液',
    });
  });

  it('清洗时保留 name', () => {
    expect(sanitizeSymbol({ code: 'sh603986', exchange: 'SH', name: '兆易创新' })).toEqual({
      code: '603986',
      exchange: 'SH',
      name: '兆易创新',
    });
    expect(sanitizeSymbol({ code: 'hk03986', exchange: 'SH', name: '锅圈' })).toEqual({
      code: '03986',
      exchange: 'HK',
      name: '锅圈',
    });
  });
});

describe('parseSymbol', () => {
  it('解析带前缀的完整串', () => {
    expect(parseSymbol('sh603986')).toEqual({ code: '603986', exchange: 'SH' });
    expect(parseSymbol('600519.SH')).toEqual({ code: '600519', exchange: 'SH' });
  });
});

describe('toThsCode', () => {
  it('清洗后能拼出合法 thscode', () => {
    expect(toThsCode(sanitizeSymbol({ code: 'sh603986', exchange: 'SH' }))).toBe('603986.SH');
  });
});

describe('基金 / 期权识别', () => {
  it('OF 为场内基金', () => {
    expect(isFundSymbol({ code: '006342', exchange: 'OF' })).toBe(true);
    expect(isFundSymbol({ code: '600519', exchange: 'SH' })).toBe(false);
  });

  it('期权代码', () => {
    expect(isOptionCode('AO2610P3150')).toBe(true);
    expect(isOptionCode('AO2610P3050')).toBe(true);
    expect(isOptionCode('600519')).toBe(false);
    expect(isOptionCode('920298')).toBe(false);
  });

  it('债券 / 可转债代码', () => {
    expect(isBondCode('10011450')).toBe(true);
    expect(isBondCode('113050')).toBe(true);
    expect(isBondCode('600519')).toBe(false);
    expect(isBondCode('000858')).toBe(false);
    expect(isBondCode('920298')).toBe(false);
  });

  it('ETF / LOF 代码', () => {
    expect(isListedFundCode('501059')).toBe(true);
    expect(isListedFundCode('510800')).toBe(true);
    expect(isListedFundCode('159915')).toBe(true);
    expect(isListedFundCode('600519')).toBe(false);
  });

  it('无 K 线契约标的', () => {
    expect(isNonKlineSymbol({ code: '006342', exchange: 'OF' })).toBe(true);
    expect(isNonKlineSymbol({ code: 'AO2610P3150', exchange: 'SH' })).toBe(true);
    expect(isNonKlineSymbol({ code: '10011450', exchange: 'SH' })).toBe(true);
    expect(isNonKlineSymbol({ code: '501059', exchange: 'SH' })).toBe(true);
    expect(isNonKlineSymbol({ code: '510800', exchange: 'SH' })).toBe(true);
    expect(isNonKlineSymbol({ code: '600519', exchange: 'SH' })).toBe(false);
  });
});
