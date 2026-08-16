/**
 * 交易时段判断（A 股，按中国时区 Asia/Shanghai 计算，不依赖设备本地时区）。
 * 周一至周五 9:30-11:30、13:00-15:00；周末与午休返回 false。
 * 注：未考虑法定节假日，仅作轮询/推送节流用，不影响数据正确性。
 *
 * 关键修复：之前用 d.getHours()（设备本地时区），若真机/模拟器时区不是中国时区，
 * 会导致交易时段判断长期为 false，行情自动刷新被彻底关掉，界面卡在旧缓存。
 */
export interface ChinaParts {
  /** 0=周日 ... 6=周六 */
  day: number;
  hour: number;
  minute: number;
}

/** 把任意 Date 拆解为中国时区（Asia/Shanghai, UTC+8）的年/月/日/时/分/周几。 */
export function chinaParts(d: Date = new Date()): ChinaParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  return {
    day: wdMap[get('weekday')] ?? 0,
    hour: Number.isNaN(hour) ? 0 : hour,
    minute: Number.isNaN(minute) ? 0 : minute,
  };
}

export function isTradingNow(d: Date = new Date()): boolean {
  const { day, hour, minute } = chinaParts(d);
  if (day === 0 || day === 6) return false;
  const mins = hour * 60 + minute;
  const morning = mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30;
  const afternoon = mins >= 13 * 60 && mins <= 15 * 60;
  return morning || afternoon;
}

// ============================================================
// 中国时区日序号（纯算术，不依赖 Intl，供 K 线新鲜度判定使用）
// ============================================================

/** 中国时区 UTC 偏移（UTC+8，无夏令时） */
const CN_OFFSET_MS = 8 * 3600 * 1000;
/** 一日的毫秒数 */
const DAY_MS = 24 * 3600 * 1000;

/**
 * 中国时区日序号（0 = 1970-01-01，该日是周四，故 dayIndex 0 的 weekday = 4）。
 * 与设备本地时区无关，任何时区设备上结果一致。
 */
export function cnDayIndex(ms: number): number {
  return Math.floor((ms + CN_OFFSET_MS) / DAY_MS);
}

/** 中国时区该日序号的星期（0=周日 … 6=周六） */
export function cnDayWeekday(dayIndex: number): number {
  return (dayIndex + 4) % 7;
}

/**
 * 本地 K 线新鲜度：最新 bar 的中国时区日期 >= 最近一个工作日
 * （今天若是工作日则含今天；不含节假日——节后首个工作日会多拉一次
 * 增量，upsert 幂等无害，但不会漏拉）。
 *
 * 保守近似（不含节假日表）覆盖的判定：
 *  - 周末打开：最新 bar = 周五 → fresh（不误拉）；
 *  - 周一开盘前打开：最新 bar = 周五 → stale → 触发一次幂等增量；
 *  - 盘中打开：最新 bar = 前一工作日 → stale → 增量刷新今日未完成 bar
 *    （与 MarketSync 既有 isSameTradingDay 语义一致，15min 防抖 + coalescer 控 QPS）。
 * 日线与分钟级统一用本函数。
 */
export function isKlineFresh(latestTs: number, nowMs: number): boolean {
  const latestDay = cnDayIndex(latestTs);
  const today = cnDayIndex(nowMs);
  // 从今天往前找最近的工作日（11 天窗口内必有一个）
  let lastTrading = today;
  for (let i = today; i >= today - 10; i--) {
    const wd = cnDayWeekday(i);
    if (wd !== 0 && wd !== 6) {
      lastTrading = i;
      break;
    }
  }
  return latestDay >= lastTrading;
}
