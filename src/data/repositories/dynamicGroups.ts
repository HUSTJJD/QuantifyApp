/**
 * 自选动态分组解析：scan / strategy / condition。
 * 纯读侧计算，不改库；由 WatchlistRepository.getGroups 在加载后调用。
 */
import type { Symbol, Quote } from '@/data/api';
import { quantStore } from '@/data/db/QuantStore';
import { getAll as getAllSignals } from '@/quant/SignalStore';
import type {
  WatchlistGroup,
  WatchlistDynamicRule,
} from '@/data/db/UserStore';

function keyOf(s: Symbol): string {
  return `${s.code}.${s.exchange}`;
}

function pctOf(q: Quote): number {
  const prev = q.prevClose ?? 0;
  if (prev <= 0) return 0;
  return ((q.last - prev) / prev) * 100;
}

/** 最新一次全市场扫描的命中标的 */
export async function resolveScanGroup(limit = 200): Promise<Symbol[]> {
  const snaps = await quantStore().listScanSnapshots(1);
  const snapId = snaps[0]?.id;
  if (!snapId) return [];
  const hits = await quantStore().listScanHits(snapId);
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const h of hits) {
    const s: Symbol = {
      code: h.code,
      exchange: h.exchange as Symbol['exchange'],
      name: h.name,
    };
    const k = keyOf(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/** 某策略的买入/卖出信号标的 */
export async function resolveStrategyGroup(
  strategyId: string,
  side: 'buy' | 'sell' | 'any' = 'buy',
  limit = 100,
): Promise<Symbol[]> {
  const signals = await getAllSignals();
  const seen = new Set<string>();
  const out: Symbol[] = [];
  for (const sig of signals) {
    if (side !== 'any' && sig.side !== side) continue;
    if (side === 'any' && sig.side === 'hold') continue;
    // 贡献里含该策略，或聚合信号即来自该策略
    const hit = (sig.contributions ?? []).some((c) => c.id === strategyId);
    if (!hit && !sig.symbolKey) continue;
    if (!hit) continue;
    const k = keyOf(sig.symbol);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...sig.symbol, name: sig.symbol.name || sig.symbol.code });
    if (out.length >= limit) break;
  }
  return out;
}

/** 条件分组：在自选或有信号的标的里按现价/涨跌幅过滤 */
export async function resolveConditionGroup(
  rule: WatchlistDynamicRule,
  universe: Symbol[],
  quotes: Quote[] | null,
): Promise<Symbol[]> {
  const priceMin = rule.priceMin ?? 0;
  const priceMax = rule.priceMax ?? 0;
  const pctMin = rule.changePctMin;
  const pctMax = rule.changePctMax;
  const quoteByKey = new Map<string, Quote>();
  for (const q of quotes ?? []) quoteByKey.set(keyOf(q.symbol), q);

  const out: Symbol[] = [];
  for (const s of universe) {
    const q = quoteByKey.get(keyOf(s));
    if (!q || q.last <= 0) continue;
    if (priceMin > 0 && q.last < priceMin) continue;
    if (priceMax > 0 && q.last > priceMax) continue;
    const p = pctOf(q);
    if (pctMin != null && pctMin !== 0 && p < pctMin) continue;
    if (pctMax != null && pctMax !== 0 && p > pctMax) continue;
    out.push(s);
  }
  return out;
}

export interface DynamicResolveContext {
  /** 当前自选（condition universe=watchlist 时用） */
  watchlist: Symbol[];
  /** 自选行情（condition 过滤用；可为空） */
  quotes?: Quote[] | null;
}

/**
 * 把动态分组的 symbols 填上（static 原样返回）。
 * 失败时保留空数组，不阻断页面。
 */
export async function resolveDynamicGroups(
  groups: WatchlistGroup[],
  ctx: DynamicResolveContext,
): Promise<WatchlistGroup[]> {
  const hasDynamic = groups.some((g) => (g.kind ?? 'static') !== 'static');
  if (!hasDynamic) return groups;

  const out: WatchlistGroup[] = [];
  for (const g of groups) {
    const kind = g.kind ?? 'static';
    if (kind === 'static') {
      out.push(g);
      continue;
    }
    try {
      let symbols: Symbol[] = [];
      if (kind === 'scan') {
        symbols = await resolveScanGroup();
      } else if (kind === 'strategy') {
        const sid = g.rule?.strategyId ?? '';
        if (sid) symbols = await resolveStrategyGroup(sid, g.rule?.side ?? 'buy');
      } else if (kind === 'condition') {
        const universe =
          g.rule?.universe === 'signals'
            ? await resolveStrategyGroup(
                g.rule?.strategyId ?? '',
                g.rule?.side ?? 'any',
                200,
              )
            : ctx.watchlist;
        symbols = await resolveConditionGroup(g.rule ?? {}, universe, ctx.quotes ?? null);
      }
      out.push({ ...g, symbols });
    } catch {
      out.push({ ...g, symbols: [] });
    }
  }
  return out;
}

export const GROUP_KIND_LABEL: Record<string, string> = {
  static: '手动',
  scan: '扫描',
  strategy: '策略',
  condition: '条件',
};

export function isDynamicGroup(g: WatchlistGroup): boolean {
  return (g.kind ?? 'static') !== 'static';
}
