/**
 * squarify —— 方块（squarified）treemap 布局算法（Bruls, Huizing & van Wijk, 2000）。
 *
 * 把一组带权重（weight，如成交额/市值）的项铺满 width×height 矩形，
 * 使得：① 每块面积正比于 weight；② 各子矩形尽量接近正方形（长宽比接近 1）。
 * 纯函数、无布局依赖，便于单测，也便于在 UI 层按测得宽度即时计算。
 */

export interface TreemapItem<T = string> {
  key: T;
  weight: number;
}

export interface TreemapRect<T = string> {
  key: T;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * @param items  带权重的项（无需预排序，内部按权重降序以保证方块化）
 * @param width  目标矩形宽
 * @param height 目标矩形高
 * @returns 与 items 一一对应的矩形（面积∝weight，全部落在 [0,width]×[0,height] 内）
 */
export function squarify<T = string>(
  items: TreemapItem<T>[],
  width: number,
  height: number,
): TreemapRect<T>[] {
  if (width <= 0 || height <= 0 || items.length === 0) return [];

  const safeTotal = items.reduce((s, it) => s + Math.max(it.weight, 0), 0);
  if (safeTotal <= 0) return [];

  // 权重归一化为面积（总面积 = width*height），并保证严格为正避免除零
  const scale = (width * height) / safeTotal;
  const areas = items
    .map((it) => ({ key: it.key, area: Math.max(it.weight, 0) * scale }))
    .sort((a, b) => b.area - a.area); // 大块优先利于方块化

  const rects: TreemapRect<T>[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  let row: typeof areas = [];
  let i = 0;

  const rowSum = (r: typeof areas): number => r.reduce((s, a) => s + a.area, 0);

  // 当前行沿「较短边」铺开，side = 较短边长；返回该行最差（最大）长宽比
  const worst = (r: typeof areas): number => {
    if (r.length === 0) return Infinity;
    const s = rowSum(r);
    if (s <= 0) return Infinity;
    const mx = Math.max(...r.map((a) => a.area));
    const mn = Math.min(...r.map((a) => a.area));
    if (mn <= 0) return Infinity;
    const side = Math.min(w, h);
    const side2 = side * side;
    const s2 = s * s;
    return Math.max((side2 * mx) / s2, s2 / (side2 * mn));
  };

  const layoutRow = (
    r: typeof areas,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
  ): void => {
    const rs = rowSum(r);
    if (rs <= 0) return;
    if (rw >= rh) {
      // 竖直条带：沿高度堆叠，条带宽 = rs/rh
      const stripW = rs / rh;
      let oy = ry;
      for (const a of r) {
        const ih = (a.area / rs) * rh;
        rects.push({ key: a.key, x: rx, y: oy, width: stripW, height: ih });
        oy += ih;
      }
    } else {
      // 水平条带：沿宽度堆叠，条带高 = rs/rw
      const stripH = rs / rw;
      let ox = rx;
      for (const a of r) {
        const iw = (a.area / rs) * rw;
        rects.push({ key: a.key, x: ox, y: ry, width: iw, height: stripH });
        ox += iw;
      }
    }
  };

  while (i < areas.length) {
    const next = areas[i];
    const withNext = row.concat(next);
    // 加入下一项不会恶化最差长宽比时才并入当前行
    if (row.length === 0 || worst(row) >= worst(withNext)) {
      row = withNext;
      i++;
    } else {
      layoutRow(row, x, y, w, h);
      const rs = rowSum(row);
      if (w >= h) {
        const strip = rs / h;
        x += strip;
        w -= strip;
      } else {
        const strip = rs / w;
        y += strip;
        h -= strip;
      }
      row = [];
    }
  }
  if (row.length) layoutRow(row, x, y, w, h);

  return rects;
}
