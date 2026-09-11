/**
 * NL 关键词扫描意图单测。
 */
import { matchNlScan } from '@/quant/nlScan';

describe('matchNlScan', () => {
  it('matches 放量', () => {
    const m = matchNlScan('今日放量股');
    expect(m?.presetId).toBe('volume_breakout');
    expect(m?.extra?.volumeSpikeRatio).toBe(2);
  });

  it('matches 金叉', () => {
    expect(matchNlScan('MACD金叉')?.presetId).toBe('golden_confirm');
  });

  it('matches 多头', () => {
    expect(matchNlScan('均线多头排列')?.presetId).toBe('pullback_ma');
  });

  it('matches 新高', () => {
    expect(matchNlScan('20日新高')?.extra?.newHighDays).toBe(20);
  });

  it('returns null for stock names', () => {
    expect(matchNlScan('贵州茅台')).toBeNull();
  });
});
