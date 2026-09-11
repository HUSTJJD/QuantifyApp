import { scoreCandidate, rankCandidatePool, reasonCoverage } from '@/quant/candidatePool';
import type { CandidateItem } from '@/quant/candidatePool';

function item(reasons: string, changePct: number | null, code: string): CandidateItem {
  return {
    symbol: { code, exchange: 'SH', name: code },
    name: code,
    reasons,
    lastClose: 10,
    changePct,
  };
}

describe('reasonCoverage', () => {
  it('空理由得 0', () => {
    expect(reasonCoverage('')).toBe(0);
  });
  it('3 条论点得满分', () => {
    expect(reasonCoverage('量比放大、均线多头、站上平台')).toBe(1);
  });
  it('1 条论点得 1/3', () => {
    expect(reasonCoverage('量比放大')).toBeCloseTo(1 / 3, 5);
  });
});

describe('scoreCandidate', () => {
  it('涨跌幅与理由共同决定分数', () => {
    const high = scoreCandidate(item('a、b、c', 5, 'A'));
    const low = scoreCandidate(item('a', 0, 'B'));
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(100);
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it('外部强度加权提高分数', () => {
    const base = scoreCandidate(item('a、b', 2, 'A'));
    const withStrength = scoreCandidate(
      item('a、b', 2, 'A'),
      { strengthWeight: 30 },
      new Map([['A.SH', 3]]),
    );
    expect(withStrength).toBeGreaterThan(base);
  });

  it('分数被夹在 0~100', () => {
    const s = scoreCandidate(item('a、b、c', 100, 'A'), {}, new Map([['A.SH', 3]]));
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe('rankCandidatePool', () => {
  it('去重 + 按分数降序', () => {
    const items = [
      item('a、b、c', 6, 'A'),
      item('a', 1, 'B'),
      item('a、b、c', 6, 'A'), // 重复 A
      item('a、b', 3, 'C'),
    ];
    const ranked = rankCandidatePool(items);
    expect(ranked).toHaveLength(3); // A 去重
    expect(ranked[0].symbol.code).toBe('A');
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
  });
});
