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
