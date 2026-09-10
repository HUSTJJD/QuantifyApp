/**
 * 分时序列计算（真·分时图数据层）。
 *
 * 由当日 1m 分钟 K 计算分时数据点：
 *  - price    ：该分钟收盘
 *  - avgPrice ：均价线 = 累计成交额 / 累计成交量（无成交额字段时为 null）
 *  - changePct：相对昨收涨跌幅 = (price - preClose) / preClose * 100
 *  - preClose ：昨收（透传，供图表绘制基准线）
 *
 * 输入须为**按时间升序**的当日分钟 K；preClose 取昨收。
 * 仅做纯数据变换，不依赖任何 UI / 存储，便于单测；图表渲染由上层接 KLineChart。
 */
import type { Candle } from '@/api';

/** 单个分时数据点 */
export interface TimeSharePoint {
  /** 该分钟时间（沿用 Candle.datetime） */
  time: number | string;
  /** 该分钟收盘价 */
  price: number;
  /** 均价线（累计成交额/累计成交量）；无成交额时为 null */
  avgPrice: number | null;
  /** 昨收（基准线） */
  preClose: number;
  /** 相对昨收涨跌幅（%） */
  changePct: number;
}

export function toTimeShareSeries(candles: Candle[], preClose: number): TimeSharePoint[] {
  const out: TimeSharePoint[] = [];
  let cumVol = 0;
  let cumAmt = 0;
  let hasAmount = true;

  for (const c of candles) {
    cumVol += c.volume;
    if (c.amount != null) cumAmt += c.amount;
    else hasAmount = false;

    const price = c.close;
    const avgPrice = hasAmount && cumVol > 0 ? cumAmt / cumVol : null;
    const changePct = preClose !== 0 ? ((price - preClose) / preClose) * 100 : 0;

    out.push({ time: c.datetime, price, avgPrice, preClose, changePct });
  }

  return out;
}
