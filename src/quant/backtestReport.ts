/**
 * 回测报告纯文本导出：把池汇总 / 单标的详报 / 样本内外 / 基准对比格式化为可复制文本。
 * 纯函数、不依赖 UI，便于单测与后续接分享/落盘。
 */
import type { BacktestResult } from './backtest';
import type { BenchmarkMetrics } from './benchmark';
import type { WalkForwardResult } from './walkForward';
import type { CombinedPortfolio } from './portfolio';
import type { BuyHoldMetrics } from './buyHold';
import type { StrategyProfile } from './profile';
import { PERIOD_LABELS, SESSION_LABELS, COMBINE_LABEL, profileLegsSummary } from './profile';
import type { Symbol } from '@/data/api';
import { displaySymbol } from '@/domain';

function pct(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function num(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

function date(ms: number): string {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export interface PoolRowExport {
  symbol: Symbol;
  ok: boolean;
  result?: BacktestResult;
  reason?: string;
}

export interface DetailExport {
  symbol: Symbol;
  result: BacktestResult;
  benchMetrics: BenchmarkMetrics | null;
  walk: WalkForwardResult | null;
  adjustNote?: string;
  /**
   * 买入持有基准（需与策略同：资金 / 费用 / 撮合 / 除权口径），
   * 缺失时报告不输出该行，避免导出「看似跑赢」的错觉。
   */
  buyHold?: BuyHoldMetrics | null;
  buyHoldExcessPct?: number;
}

export interface ReportExportInput {
  profile: StrategyProfile;
  note?: string;
  slippageBp: number;
  initCash: number;
  pool: PoolRowExport[];
  detail?: DetailExport | null;
  /** 多标的等权合成结果（可选） */
  portfolio?: CombinedPortfolio | null;
  generatedAt?: number;
}

/** 多标的组合（等权合成）段 */
export function formatPortfolioSection(pf: CombinedPortfolio): string {
  if (!pf || pf.nav.length === 0) return '【组合（等权合成）】无有效样本';
  const m = pf.metrics;
  return [
    '【组合（等权合成）】',
    `标的 ${pf.legCount} 只 · 收益 ${pct(m.totalReturnPct)} · 年化 ${pct(m.annualizedReturnPct)} · 最大回撤 ${m.maxDrawdownPct.toFixed(1)}%`,
    `夏普 ${num(m.sharpe)} · 索提诺 ${num(m.sortino)} · 卡玛 ${num(m.calmar)} · 年化波动 ${m.volatilityPct.toFixed(1)}%`,
    `样本齐全度 ${pf.fullOverlapPct.toFixed(0)}%（其余日期部分标的缺数据，已按当日有效标的等权）`,
    '说明：各标的独立回测后按日收益等权合成，未考虑同时持仓的资金竞争与 maxPositions 约束。',
  ].join('\n');
}

/** 池汇总段 */
export function formatPoolSection(pool: PoolRowExport[]): string {
  const ok = pool.filter((r) => r.ok && r.result);
  if (ok.length === 0) return '【池汇总】无成功结果';
  const avgRet = ok.reduce((s, r) => s + r.result!.totalReturnPct, 0) / ok.length;
  const avgWin = ok.reduce((s, r) => s + r.result!.winRate, 0) / ok.length;
  const avgDd = ok.reduce((s, r) => s + r.result!.maxDrawdownPct, 0) / ok.length;
  const trades = ok.reduce((s, r) => s + r.result!.trades.length, 0);
  const lines: string[] = [
    '【池汇总】',
    `成功 ${ok.length}/${pool.length} · 平均收益 ${pct(avgRet)} · 平均胜率 ${avgWin.toFixed(0)}% · 平均回撤 ${avgDd.toFixed(1)}% · 总成交 ${trades}`,
    '',
    '代码 | 收益 | 年化 | 回撤 | 夏普 | 胜率 | 成交',
  ];
  for (const r of pool) {
    if (!r.ok || !r.result) {
      lines.push(`${displaySymbol(r.symbol)} | 失败${r.reason ? `（${r.reason}）` : ''}`);
      continue;
    }
    const x = r.result;
    lines.push(
      `${displaySymbol(r.symbol)} | ${pct(x.totalReturnPct)} | ${pct(x.annualizedReturnPct)} | ${x.maxDrawdownPct.toFixed(1)}% | ${num(x.sharpe)} | ${x.winRate.toFixed(0)}% | ${x.trades.length}`,
    );
  }
  return lines.join('\n');
}

/** 单标的详报段 */
export function formatDetailSection(d: DetailExport): string {
  const x = d.result;
  const lines: string[] = [
    `【详报 · ${displaySymbol(d.symbol)}】`,
    `区间收益 ${pct(x.totalReturnPct)} · 年化 ${pct(x.annualizedReturnPct)} · 最大回撤 ${x.maxDrawdownPct.toFixed(1)}% · 夏普 ${num(x.sharpe)}`,
    `索提诺 ${num(x.sortino)} · 卡玛 ${num(x.calmar)} · 年化波动 ${x.volatilityPct.toFixed(1)}% · 最长回撤 ${x.longestDrawdownBars} 根`,
    `胜率 ${x.winRate.toFixed(0)}% · 盈亏比 ${Number.isFinite(x.profitFactor) ? x.profitFactor.toFixed(2) : '∞'} · 平均持有 ${x.avgHoldingBars.toFixed(1)} 根 · 持仓占比 ${x.exposurePct.toFixed(0)}%`,
    `最佳单笔 ${pct(x.bestTradePct)} · 最差单笔 ${pct(x.worstTradePct)} · 总费用 ${num(x.totalFees, 0)} · 成交 ${x.trades.length} 笔`,
    `初始资金 ${x.initCash.toFixed(0)} · 期末权益 ${x.finalEquity.toFixed(2)}`,
  ];
  if (d.adjustNote) lines.push(`复权：${d.adjustNote}`);
  if (d.buyHold) {
    const bh = d.buyHold;
    lines.push(
      `vs 买入持有（同资金/费用/撮合/除权口径）：${pct(bh.totalReturnPct)} · 超额 ${
        d.buyHoldExcessPct != null ? pct(d.buyHoldExcessPct) : '—'
      } · ${bh.shares > 0 ? `${bh.shares}股 @${bh.buyPrice.toFixed(2)}` : '未成交'}${
        bh.corpEvents.length > 0 ? ` · 除权调整 ${bh.corpEvents.length} 次` : ''
      }`,
    );
  }
  if (d.benchMetrics) {
    const b = d.benchMetrics;
    lines.push(
      `vs 沪深300：基准 ${pct(b.benchmarkReturnPct)} · 超额 ${pct(b.excessReturnPct)} · 信息比率 ${num(b.informationRatio)} · 跟踪误差 ${b.trackingErrorPct.toFixed(1)}%`,
    );
    lines.push(
      `Beta ${num(b.beta)} · 年化Alpha ${pct(b.alphaAnnualPct)} · 相关系数 ${num(b.correlation)}`,
    );
  }
  if (d.walk) {
    const w = d.walk;
    lines.push(
      `样本内 ${pct(w.train.totalReturnPct)}（夏普 ${num(w.train.sharpe)}） · 样本外 ${pct(w.val.totalReturnPct)}（夏普 ${num(w.val.sharpe)}）`,
    );
    lines.push(
      w.likelyOverfit
        ? `疑似过拟合：收益衰减 ${w.returnDecayPct.toFixed(0)}%、夏普衰减 ${w.sharpeDecayPct.toFixed(0)}%`
        : `衰减：收益 ${w.returnDecayPct.toFixed(0)}% · 夏普 ${w.sharpeDecayPct.toFixed(0)}%（未触发阈值）`,
    );
  }
  // 最近成交（最多 20 笔，倒序）
  const recent = x.trades.slice(-20).reverse();
  if (recent.length > 0) {
    lines.push('', '最近成交（新→旧，最多20笔）：');
    for (const t of recent) {
      const pnlNote = t.side === 'sell' && t.pnl != null ? ` 本笔 ${pct(t.pnlPct ?? 0)}` : '';
      lines.push(
        `${date(t.time)} ${t.side === 'buy' ? '买' : '卖'} ${t.shares}股 @${t.price.toFixed(2)} 费${t.fee.toFixed(2)}${pnlNote}`,
      );
    }
  }
  return lines.join('\n');
}

/** 完整导出文本 */
export function formatBacktestReport(input: ReportExportInput): string {
  const p = input.profile;
  const head: string[] = [
    '=== QuantifyApp 回测报告 ===',
    `策略：${p.name}（${profileLegsSummary(p)} · ${COMBINE_LABEL[p.combineMode]}）`,
    `周期 ${PERIOD_LABELS[p.trade.period] ?? p.trade.period} · 时段 ${SESSION_LABELS[p.trade.session] ?? p.trade.session} · 仓位 ${(p.trade.positionRatio * 100).toFixed(0)}% · 最大持仓 ${p.trade.maxPositions}`,
    `止盈 ${p.exit.takeProfitPct || '关'}% · 止损 ${p.exit.stopLossPct || '关'}% · 移动止损 ${p.exit.trailingPct || '关'}%`,
    `滑点 ${input.slippageBp}bp · 初始资金 ${input.initCash.toLocaleString('zh-CN')} · 次日开盘成交`,
    input.note ? `样本：${input.note}` : '',
    `导出时间：${date(input.generatedAt ?? Date.now())}`,
    '',
  ].filter((s, i, arr) => s !== '' || i < arr.length - 1);

  const parts = [head.join('\n'), formatPoolSection(input.pool)];
  if (input.portfolio) parts.push('', formatPortfolioSection(input.portfolio));
  if (input.detail) parts.push('', formatDetailSection(input.detail));
  parts.push('', '注：回测不等于未来收益；样本外失效时勿直接实盘。');
  return parts.join('\n');
}
