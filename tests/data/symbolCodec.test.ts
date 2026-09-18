/**
 * 各数据源 SymbolCodec：toSource / fromSource / covers。
 */
import { fuyaoCodec, toThsCode } from '@/data/api/sources/codecs/fuyaoCodec';
import {
  stockSdkCodec,
  toSdkCode,
  marketNamespace,
  exchangeOf,
} from '@/data/api/sources/codecs/stockSdkCodec';
import { longportCodec } from '@/data/api/sources/codecs/longportCodec';
import { dukascopyCodec } from '@/data/api/sources/codecs/dukascopyCodec';
import { fundApiCodec } from '@/data/api/sources/codecs/fundApiCodec';
import { codecCoversAll } from '@/data/api/codec';
import { symbolKey } from '@/domain/symbol';
import type { AppSymbol } from '@/domain/symbol';

const SH: AppSymbol = { code: '600519', exchange: 'SH' };
const SZ: AppSymbol = { code: '000001', exchange: 'SZ' };
const HK: AppSymbol = { code: '0700', exchange: 'HK' };
const US: AppSymbol = { code: 'AAPL', exchange: 'US' };
const OF: AppSymbol = { code: '006342', exchange: 'OF' };
const EM: AppSymbol = { code: 'BK1027', exchange: 'EM' };
const TI: AppSymbol = { code: '886042', exchange: 'TI' };

describe('fuyaoCodec', () => {
  it('toSource → thscode CODE.EXCHANGE', () => {
    expect(fuyaoCodec.toSource(SH)).toBe('600519.SH');
    expect(fuyaoCodec.toSource(TI)).toBe('886042.TI');
    expect(fuyaoCodec.toSource(OF)).toBe('006342.OF');
  });

  it('HK / EM：toSource null，covers false', () => {
    expect(fuyaoCodec.toSource(HK)).toBeNull();
    expect(fuyaoCodec.toSource(US)).toBeNull();
    expect(fuyaoCodec.toSource(EM)).toBeNull();
    expect(fuyaoCodec.covers(HK)).toBe(false);
    expect(fuyaoCodec.covers(EM)).toBe(false);
  });

  it('toThsCode 对 HK 抛错', () => {
    expect(() => toThsCode(HK)).toThrow();
  });

  it('fromSource roundtrip', () => {
    expect(fuyaoCodec.fromSource('600519.SH')).toEqual(SH);
  });
});

describe('stockSdkCodec', () => {
  it('toSource → 裸代码', () => {
    expect(stockSdkCodec.toSource(SH)).toBe('600519');
    expect(stockSdkCodec.toSource(HK)).toBe('0700');
    expect(stockSdkCodec.toSource(US)).toBe('AAPL');
    expect(stockSdkCodec.toSource(EM)).toBe('BK1027');
    expect(toSdkCode(SH)).toBe('600519');
  });

  it('marketNamespace', () => {
    expect(marketNamespace(SH)).toBe('cn');
    expect(marketNamespace(HK)).toBe('hk');
    expect(marketNamespace(US)).toBe('us');
    expect(marketNamespace(OF)).toBe('fund');
  });

  it('fromSource 用 hint / 启发式定 exchange', () => {
    expect(stockSdkCodec.fromSource('600519')).toEqual(SH);
    expect(stockSdkCodec.fromSource('0700', { exchange: 'HK' })).toEqual(HK);
    expect(stockSdkCodec.fromSource('AAPL', { exchange: 'US' })).toEqual(US);
    expect(exchangeOf('HK', '00700')).toBe('HK');
    expect(exchangeOf('CN', '600519')).toBe('SH');
  });

  it('covers：沪深港美基金板块', () => {
    expect(codecCoversAll(stockSdkCodec, [SH, SZ, HK, US, OF, EM])).toBe(true);
  });
});

describe('longportCodec', () => {
  it('仅 HK/US；线格式 700.HK / AAPL.US', () => {
    expect(longportCodec.covers(HK)).toBe(true);
    expect(longportCodec.covers(US)).toBe(true);
    expect(longportCodec.covers(SH)).toBe(false);
    expect(longportCodec.toSource(SH)).toBeNull();
    expect(longportCodec.toSource(US)).toBe('AAPL.US');
  });

  it('看板标的：0700 → 0700.HK', () => {
    expect(longportCodec.toSource({ code: '0700', exchange: 'HK' })).toBe('0700.HK');
  });

  it('fromSource', () => {
    const us = longportCodec.fromSource('AAPL.US');
    expect(us?.code).toBe('AAPL');
    expect(us?.exchange).toBe('US');
    expect(longportCodec.fromSource('0700.HK')?.exchange).toBe('HK');
  });
});

describe('dukascopyCodec', () => {
  it('仅白名单全球指数', () => {
    const spx: AppSymbol = { code: 'USA500', exchange: 'US' };
    expect(dukascopyCodec.covers(spx)).toBe(true);
    expect(dukascopyCodec.toSource(spx)).toBe('usa500idxusd');
    expect(dukascopyCodec.covers(SH)).toBe(false);
    expect(dukascopyCodec.toSource(SH)).toBeNull();
  });

  it('fromSource instrument id', () => {
    expect(dukascopyCodec.fromSource('usa500idxusd')).toEqual({
      code: 'USA500',
      exchange: 'US',
      name: '标普500',
    });
  });
});

describe('fundApiCodec', () => {
  it('wire = 数字代码；fromSource 恒 OF；非 OF 返回 null', () => {
    expect(fundApiCodec.toSource(OF)).toBe('006342');
    expect(fundApiCodec.fromSource('006342')).toEqual(OF);
    expect(fundApiCodec.covers(OF)).toBe(true);
    expect(fundApiCodec.covers(SH)).toBe(false);
    expect(fundApiCodec.toSource(SH)).toBeNull();
  });
});

describe('规范键与 codec 一致', () => {
  it('fuyao 线格式 = symbolKey 对于其覆盖集', () => {
    for (const s of [SH, SZ, OF, TI]) {
      expect(fuyaoCodec.toSource(s)).toBe(symbolKey(s));
    }
  });
});
