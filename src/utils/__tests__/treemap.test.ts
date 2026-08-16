import { squarify } from '../treemap';

const EPS = 1e-6;

describe('squarify', () => {
  it('空输入/非法尺寸返回空数组', () => {
    expect(squarify([], 300, 200)).toEqual([]);
    expect(squarify([{ key: 'a', weight: 1 }], 0, 200)).toEqual([]);
    expect(squarify([{ key: 'a', weight: 1 }], 300, -5)).toEqual([]);
  });

  it('所有项权重为 0 时返回空数组', () => {
    expect(squarify([{ key: 'a', weight: 0 }, { key: 'b', weight: 0 }], 300, 200)).toEqual([]);
  });

  it('矩形数量与输入一致且面积之和等于总面积', () => {
    const items = [
      { key: 'a', weight: 5 },
      { key: 'b', weight: 3 },
      { key: 'c', weight: 2 },
      { key: 'd', weight: 1 },
    ];
    const W = 300;
    const H = 200;
    const rects = squarify(items, W, H);
    expect(rects).toHaveLength(items.length);
    const totalArea = rects.reduce((s, r) => s + r.width * r.height, 0);
    expect(totalArea).toBeCloseTo(W * H, 3);
  });

  it('所有矩形都落在边界内、不越界', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ key: `s${i}`, weight: Math.random() * 10 + 1 }));
    const W = 336;
    const H = 320;
    const rects = squarify(items, W, H);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-EPS);
      expect(r.y).toBeGreaterThanOrEqual(-EPS);
      expect(r.x + r.width).toBeLessThanOrEqual(W + EPS);
      expect(r.y + r.height).toBeLessThanOrEqual(H + EPS);
      expect(r.width).toBeGreaterThan(0);
      expect(r.height).toBeGreaterThan(0);
    }
  });

  it('面积正比于权重：权重越大面积越大', () => {
    const items = [
      { key: 'big', weight: 8 },
      { key: 'mid', weight: 4 },
      { key: 'small', weight: 1 },
    ];
    const rects = squarify(items, 400, 300);
    const areaOf = (k: string) => {
      const r = rects.find((x) => x.key === k)!;
      return r.width * r.height;
    };
    expect(areaOf('big')).toBeGreaterThan(areaOf('mid'));
    expect(areaOf('mid')).toBeGreaterThan(areaOf('small'));
    // 最大块面积不应低于平均值（避免过度细长）
    const avg = (400 * 300) / 3;
    expect(areaOf('big')).toBeGreaterThanOrEqual(avg);
  });

  it('不同尺寸输入都能铺满（面积守恒）', () => {
    const items = [{ key: 'x', weight: 2 }, { key: 'y', weight: 2 }, { key: 'z', weight: 1 }];
    for (const [W, H] of [[100, 500], [500, 100], [250, 250], [336, 360]]) {
      const rects = squarify(items, W, H);
      const total = rects.reduce((s, r) => s + r.width * r.height, 0);
      expect(total).toBeCloseTo(W * H, 2);
    }
  });
});
