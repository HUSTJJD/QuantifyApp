/**
 * 市况 regime 判定与策略推荐（对齐 Opptrix discoverProfiles）。
 * 纯启发式，仅作参考提示，不构成投资建议，不自动下单。
 */
import { marketData } from '@/data/api';
import { storage } from '@/data/db/storage';

export type Regime = 'panic' | 'cautious' | 'neutral' | 'euphoria' | 'unknown';

export interface RegimeInput {
  /** 大盘涨跌幅 % */
  indexPct?: number | null;
  limitUpCount?: number | null;
  limitDownCount?: number | null;
  /** 上涨家数占比 0~1（可选） */
  upRatio?: number | null;
}

export interface RegimeResult {
  regime: Regime;
  reason: string;
  inputs: RegimeInput;
  computedAt: number;
}

const CACHE_KEY = 'regime.today.v1';

export function detectRegime(input: RegimeInput): RegimeResult {
  const { indexPct, limitUpCount, limitDownCount, upRatio } = input;
  if (indexPct == null && limitUpCount == null && limitDownCount == null && upRatio == null) {
    return { regime: 'unknown', reason: '行情数据不足', inputs: input, computedAt: Date.now() };
  }

  const up = limitUpCount ?? 0;
  const down = limitDownCount ?? 0;
  const hasLimit = limitUpCount != null || limitDownCount != null;
  const idx = indexPct ?? 0;

  if (hasLimit && down > 0 && up > 0 && down >= up * 2 && (indexPct == null || indexPct <= -0.8)) {
    return {
      regime: 'panic',
      reason: `跌停 ${down} 家显著多于涨停 ${up}${indexPct != null ? `，大盘 ${idx.toFixed(2)}%` : ''}`,
      inputs: input,
      computedAt: Date.now(),
    };
  }
  if (hasLimit && up > 0 && down > 0 && up >= down * 2 && (indexPct == null || indexPct >= 0.5)) {
    return {
      regime: 'euphoria',
      reason: `涨停 ${up} 家显著多于跌停 ${down}${indexPct != null ? `，大盘 +${idx.toFixed(2)}%` : ''}`,
      inputs: input,
      computedAt: Date.now(),
    };
  }
  if ((upRatio != null && (upRatio <= 0.3 || upRatio >= 0.7)) || Math.abs(idx) >= 1.5) {
    return {
      regime: 'cautious',
      reason:
        upRatio != null && upRatio <= 0.3
          ? `上涨家数占比仅 ${(upRatio * 100).toFixed(0)}%，情绪偏弱`
          : upRatio != null && upRatio >= 0.7
            ? `上涨家数占比 ${(upRatio * 100).toFixed(0)}%，情绪偏热`
            : `大盘波动 ${idx.toFixed(2)}%，注意仓位`,
      inputs: input,
      computedAt: Date.now(),
    };
  }
  return {
    regime: 'neutral',
    reason: '涨跌停与大盘均无极端信号',
    inputs: input,
    computedAt: Date.now(),
  };
}

export const REGIME_LABEL: Record<Regime, string> = {
  panic: '恐慌',
  cautious: '谨慎',
  neutral: '中性',
  euphoria: '亢奋',
  unknown: '未知',
};

export const REGIME_PRESETS: Record<Exclude<Regime, 'unknown'>, { templateIds: string[]; note: string }> = {
  panic: {
    templateIds: ['trend_confirm'],
    note: '控制仓位，优先趋势确认，避免抢反弹',
  },
  cautious: {
    templateIds: ['trend_confirm', 'oversold_bounce'],
    note: '降低单笔仓位，等待更清晰信号',
  },
  neutral: {
    templateIds: ['trend_confirm', 'breakout_momentum'],
    note: '可按计划启用趋势/突破模板，严格止损',
  },
  euphoria: {
    templateIds: ['breakout_momentum'],
    note: '情绪偏热，注意追高风险与止盈',
  },
};

/** 拉取涨跌停与上证指数，计算 regime（失败返回 unknown） */
export async function loadRegime(force = false): Promise<RegimeResult> {
  const now = Date.now();
  if (!force) {
    try {
      const cached = await storage.getObject<RegimeResult>(CACHE_KEY);
      if (cached && now - cached.computedAt < 30 * 60_000) return cached;
    } catch {
      // ignore
    }
  }
  let indexPct: number | null = null;
  let limitUpCount: number | null = null;
  let limitDownCount: number | null = null;
  try {
    const qs = await marketData.getQuotes([{ code: '000001', exchange: 'SH' }]);
    const q = qs?.[0];
    if (q) {
      indexPct = q.changePct != null ? q.changePct : q.prevClose ? ((q.last - q.prevClose) / q.prevClose) * 100 : null;
    }
  } catch {
    // ignore
  }
  try {
    const [up, down] = await Promise.all([
      marketData.getLimitUpPool({ size: 200 }),
      marketData.getLimitDownPool({ size: 200 }),
    ]);
    const count = (r: { items?: unknown[]; pagination?: { total?: number } } | unknown[] | undefined) => {
      if (!r) return null;
      if (Array.isArray(r)) return r.length;
      if (r.pagination?.total != null && r.pagination.total > 0) return r.pagination.total;
      return r.items?.length ?? 0;
    };
    limitUpCount = count(up as never);
    limitDownCount = count(down as never);
  } catch {
    // ignore
  }
  const result = detectRegime({ indexPct, limitUpCount, limitDownCount });
  await storage.setObject(CACHE_KEY, result).catch(() => undefined);
  return result;
}
