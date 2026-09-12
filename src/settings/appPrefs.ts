/**
 * 应用偏好（设置页读写）。
 * 体量小、整存整取，走 KV storage；业务层通过 getAppPrefs / setAppPrefs 访问。
 */
import { storage } from '@/data/db/storage';
import type { KlinePeriod } from '@/data/api';
import type { SignalPeriod } from '@/quant/profile';

export interface AppPrefs {
  /** 行情轮询间隔（秒），默认 5；3~60 */
  quoteIntervalSec: number;
  /** 新建策略默认单笔仓位比例 */
  defaultPositionRatio: number;
  /** 快速回测默认初始资金 */
  defaultInitCash: number;
  /** 默认 K 线周期（个股详情等） */
  defaultKlinePeriod: KlinePeriod;
  /** 新建策略默认信号K线周期 */
  defaultSignalPeriod: SignalPeriod;
  /** 首页是否展示热股榜 */
  showHotStocks: boolean;
  /** 首页是否展示涨跌停概览 */
  showLimitBoard: boolean;
  /** 首页是否展示大盘资金流 */
  showFundFlow: boolean;
  /** 首页是否展示盘中资金流排行（板块/个股 前五） */
  showFundFlowRanks: boolean;
  /** 首页是否展示北向/两融脉搏 */
  showMarketPulse: boolean;
  /** 首页是否展示今日异动 */
  showTodaySurge: boolean;
  /** 首页热力图维度：行业 / 概念 */
  heatmapTag: 'industry' | 'cn_concept';
  /** 首页热力图颜色指标 */
  heatmapMetric: 'pct' | 'amount' | 'volume';
  /** 是否已完成首启引导 */
  hasOnboarded: boolean;
  /** 主战场（引导页采集） */
  marketPrefs: Array<'A' | 'HK' | 'US'>;
  /** 风险风格：稳健 / 平衡 / 进取 */
  riskStyle: 'conservative' | 'balanced' | 'aggressive';
  /** 盘后摘要通知开关 */
  notifyDigest: boolean;
  /** 盘后摘要时间 HH:mm（本地） */
  notifyDigestTime: string;
  /** 价格/异动本地通知 */
  notifyPriceAlert: boolean;
}

const KEY = 'app.prefs.v1';

const SIGNAL_PERIODS: SignalPeriod[] = ['day', '60m', '30m', '15m', '5m', '1m'];

export const DEFAULT_PREFS: AppPrefs = {
  quoteIntervalSec: 5,
  defaultPositionRatio: 1 / 3,
  defaultInitCash: 100_000,
  defaultKlinePeriod: 'day',
  defaultSignalPeriod: 'day',
  showHotStocks: true,
  showLimitBoard: true,
  showFundFlow: true,
  showFundFlowRanks: true,
  showMarketPulse: true,
  showTodaySurge: true,
  heatmapTag: 'industry',
  heatmapMetric: 'pct',
  hasOnboarded: false,
  marketPrefs: ['A'],
  riskStyle: 'balanced',
  notifyDigest: false,
  notifyDigestTime: '15:10',
  notifyPriceAlert: true,
};

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normSignalPeriod(v: unknown): SignalPeriod {
  return SIGNAL_PERIODS.includes(v as SignalPeriod) ? (v as SignalPeriod) : 'day';
}

export async function getAppPrefs(): Promise<AppPrefs> {
  const saved = await storage.getObject<Partial<AppPrefs>>(KEY);
  if (!saved || typeof saved !== 'object') return { ...DEFAULT_PREFS };
  return {
    quoteIntervalSec: clamp(saved.quoteIntervalSec ?? DEFAULT_PREFS.quoteIntervalSec, 3, 60, 5),
    defaultPositionRatio: clamp(saved.defaultPositionRatio ?? DEFAULT_PREFS.defaultPositionRatio, 0.1, 1, 1 / 3),
    defaultInitCash: clamp(saved.defaultInitCash ?? DEFAULT_PREFS.defaultInitCash, 10_000, 100_000_000, 100_000),
    defaultKlinePeriod: saved.defaultKlinePeriod ?? DEFAULT_PREFS.defaultKlinePeriod,
    defaultSignalPeriod: normSignalPeriod(saved.defaultSignalPeriod ?? DEFAULT_PREFS.defaultSignalPeriod),
    showHotStocks: saved.showHotStocks ?? true,
    showLimitBoard: saved.showLimitBoard ?? true,
    showFundFlow: saved.showFundFlow ?? true,
    showFundFlowRanks: saved.showFundFlowRanks ?? true,
    showMarketPulse: saved.showMarketPulse ?? true,
    showTodaySurge: saved.showTodaySurge ?? true,
    heatmapTag: saved.heatmapTag === 'cn_concept' ? 'cn_concept' : 'industry',
    heatmapMetric:
      saved.heatmapMetric === 'amount' || saved.heatmapMetric === 'volume'
        ? saved.heatmapMetric
        : 'pct',
    hasOnboarded: Boolean(saved.hasOnboarded),
    marketPrefs:
      Array.isArray(saved.marketPrefs) && saved.marketPrefs.length > 0
        ? saved.marketPrefs.filter((m) => m === 'A' || m === 'HK' || m === 'US')
        : ['A'],
    riskStyle:
      saved.riskStyle === 'conservative' || saved.riskStyle === 'aggressive'
        ? saved.riskStyle
        : 'balanced',
    notifyDigest: Boolean(saved.notifyDigest),
    notifyDigestTime: typeof saved.notifyDigestTime === 'string' ? saved.notifyDigestTime : '15:10',
    notifyPriceAlert: saved.notifyPriceAlert !== false,
  };
}

export async function setAppPrefs(patch: Partial<AppPrefs>): Promise<AppPrefs> {
  const cur = await getAppPrefs();
  const next: AppPrefs = { ...cur, ...patch };
  // 再夹一次，防止直接写入越界
  next.quoteIntervalSec = clamp(next.quoteIntervalSec, 3, 60, 5);
  next.defaultPositionRatio = clamp(next.defaultPositionRatio, 0.1, 1, 1 / 3);
  next.defaultInitCash = clamp(next.defaultInitCash, 10_000, 100_000_000, 100_000);
  next.defaultSignalPeriod = normSignalPeriod(next.defaultSignalPeriod);
  await storage.setObject(KEY, next);
  return next;
}

/** 同步读缓存（QuoteFeed 启动时用；未加载则回退默认） */
let mem: AppPrefs | null = null;
export async function loadAppPrefsCached(): Promise<AppPrefs> {
  if (!mem) mem = await getAppPrefs();
  return mem;
}
export function peekAppPrefs(): AppPrefs {
  return mem ?? { ...DEFAULT_PREFS };
}
export function primeAppPrefs(p: AppPrefs): void {
  mem = p;
}
