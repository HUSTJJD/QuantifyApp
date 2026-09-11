/**
 * 行情展示格式化（移植自 kline-charts-react utils/formatters，适配 RN）。
 */

export function smartNumber(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '--';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(decimals).replace(/\.?0+$/, '');
}

export function formatNumber(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '--';
  const fixed = value.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart ? `${grouped}.${decPart}` : grouped;
}

export function formatPrice(value: number | null | undefined, decimals = 2): string {
  return formatNumber(value, decimals);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatChange(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function formatVolume(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '--';
  if (value >= 1e8) return `${smartNumber(value / 1e8, 2)}亿`;
  if (value >= 1e4) return `${smartNumber(value / 1e4, 2)}万`;
  return value.toFixed(0);
}

export function formatAmount(value: number | null | undefined): string {
  return formatVolume(value);
}

/** 安全解析日期字符串（避免 YYYY-MM-DD 被当 UTC 导致少一天） */
export function parseLocalDate(input: string | number | Date): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const match = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] ?? 0),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
    );
  }
  return new Date(input);
}

export function formatDate(input: string | number | Date, format = 'YYYY-MM-DD'): string {
  const d = parseLocalDate(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const p = (n: number) => String(n).padStart(2, '0');
  return format
    .replace('YYYY', String(d.getFullYear()))
    .replace('MM', p(d.getMonth() + 1))
    .replace('DD', p(d.getDate()))
    .replace('HH', p(d.getHours()))
    .replace('mm', p(d.getMinutes()));
}

/** 蜡烛图 tooltip 用的简短文本（RN 无 HTML，输出纯文本行） */
export function formatCandleTooltipLines(params: {
  date: string | number | Date;
  open?: number | null;
  high?: number | null;
  low?: number | null;
  close?: number | null;
  volume?: number | null;
  change?: number | null;
  changePercent?: number | null;
}): string[] {
  const lines = [formatDate(params.date, 'YYYY-MM-DD HH:mm')];
  if (params.open != null) lines.push(`开 ${formatPrice(params.open)}`);
  if (params.high != null) lines.push(`高 ${formatPrice(params.high)}`);
  if (params.low != null) lines.push(`低 ${formatPrice(params.low)}`);
  if (params.close != null) lines.push(`收 ${formatPrice(params.close)}`);
  if (params.change != null && params.changePercent != null) {
    lines.push(`涨跌 ${formatChange(params.change)} (${formatPercent(params.changePercent)})`);
  }
  if (params.volume != null) lines.push(`量 ${formatVolume(params.volume)}`);
  return lines;
}
