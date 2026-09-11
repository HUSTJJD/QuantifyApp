/**
 * 多市场交易时段（A / 港 / 美），用于自动刷新门控。
 * 与 utils/trading.ts（仅 A 股）互补；此处按市场时区判断。
 */
import type { ChartMarket } from './types';

interface MarketSessionConfig {
  timeZone: string;
  /** [startMin, endMin) 分钟自 00:00，end 为闭市点 */
  sessions: Array<[number, number]>;
}

const MARKET_SESSIONS: Record<ChartMarket, MarketSessionConfig> = {
  A: {
    timeZone: 'Asia/Shanghai',
    sessions: [
      [9 * 60 + 30, 11 * 60 + 30],
      [13 * 60, 15 * 60],
    ],
  },
  HK: {
    timeZone: 'Asia/Hong_Kong',
    sessions: [
      [9 * 60 + 30, 12 * 60],
      [13 * 60, 16 * 60],
    ],
  },
  US: {
    timeZone: 'America/New_York',
    sessions: [[9 * 60 + 30, 16 * 60]],
  },
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = getFormatter(timeZone).formatToParts(date);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { weekday, minutes: hour * 60 + minute };
}

/** 对应市场当前是否处于交易时段（不含周末；未处理节假日） */
export function isMarketTradingTime(market: ChartMarket, date: Date = new Date()): boolean {
  const cfg = MARKET_SESSIONS[market];
  if (!cfg) return false;
  const { weekday, minutes } = zonedParts(date, cfg.timeZone);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  return cfg.sessions.some(([start, end]) => minutes >= start && minutes < end);
}

export const MARKET_TIME_ZONES: Record<ChartMarket, string> = {
  A: 'Asia/Shanghai',
  HK: 'Asia/Hong_Kong',
  US: 'America/New_York',
};
