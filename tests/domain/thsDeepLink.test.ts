/**
 * 同花顺深链构建单测（纯 URL，不拉起 App）。
 */
import {
  stockDetailUrl,
  indexUrl,
  boardUrl,
  watchlistUrl,
  hotlistUrl,
  monitorUrl,
  analyzeUrl,
  detailUrlForSymbol,
  analyzeUrlForSymbol,
  resolveThsPage,
  thsJumpCode,
} from '@/utils/thsDeepLink';
import type { Symbol } from '@/data/api';

const CN = (code: string, exchange: Symbol['exchange'] = 'SH'): Symbol => ({ code, exchange });

describe('thsDeepLink URL 构建', () => {
  it('个股详情 / 诊股', () => {
    expect(stockDetailUrl('600519')).toBe('10jqka://stock/detail?code=600519');
    expect(analyzeUrl('600519')).toBe('10jqka://stock/analyze?code=600519');
  });

  it('指数 / 板块', () => {
    expect(indexUrl('000300')).toBe('10jqka://market/index?code=000300');
    expect(boardUrl('BK1027')).toBe('10jqka://plate/detail?code=BK1027');
  });

  it('无参工具页', () => {
    expect(watchlistUrl()).toBe('10jqka://portfolio/my');
    expect(hotlistUrl()).toBe('10jqka://market/hotlist');
    expect(monitorUrl()).toBe('10jqka://monitor/home');
  });

  it('thsJumpCode 去掉交易所后缀', () => {
    expect(thsJumpCode({ code: '600519', exchange: 'SH' })).toBe('600519');
    expect(thsJumpCode({ code: '600519.SH', exchange: 'SH' })).toBe('600519');
    expect(thsJumpCode({ code: 'BK1027', exchange: 'SH' })).toBe('BK1027');
  });

  it('resolveThsPage 自动分流', () => {
    expect(resolveThsPage(CN('600519', 'SH'))).toBe('stockDetail');
    expect(resolveThsPage(CN('000300', 'SH'))).toBe('index');
    expect(resolveThsPage(CN('399001', 'SZ'))).toBe('index');
    expect(resolveThsPage(CN('886042', 'TI'))).toBe('board');
    expect(resolveThsPage(CN('BK1027', 'SH'))).toBe('board');
    expect(resolveThsPage(CN('00700', 'HK'))).toBe('stockDetail');
  });

  it('detailUrlForSymbol / analyzeUrlForSymbol', () => {
    expect(detailUrlForSymbol(CN('600519'))).toBe('10jqka://stock/detail?code=600519');
    expect(detailUrlForSymbol(CN('000300'))).toBe('10jqka://market/index?code=000300');
    expect(detailUrlForSymbol(CN('BK1027'))).toBe('10jqka://plate/detail?code=BK1027');
    expect(analyzeUrlForSymbol(CN('600519'))).toBe('10jqka://stock/analyze?code=600519');
  });
});
