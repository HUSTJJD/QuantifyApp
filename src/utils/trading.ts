/**
 * 交易时段判断（A 股，本地时间）。
 * 周一至周五 9:30-11:30、13:00-15:00；周末与午休返回 false。
 * 注：未考虑法定节假日，仅作轮询/推送节流用，不影响数据正确性。
 */
export function isTradingNow(d: Date = new Date()): boolean {
  const day = d.getDay(); // 0=周日, 6=周六
  if (day === 0 || day === 6) return false;
  const mins = d.getHours() * 60 + d.getMinutes();
  const morning = mins >= 9 * 60 + 30 && mins <= 11 * 60 + 30;
  const afternoon = mins >= 13 * 60 && mins <= 15 * 60;
  return morning || afternoon;
}
