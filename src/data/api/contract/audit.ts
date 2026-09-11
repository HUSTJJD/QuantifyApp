/**
 * contract/audit.ts —— 能力审计（静态，不联网）。
 *
 * 回答三个问题：
 *  1. 声明 ⇔ 实现 是否一致（capabilities 白名单 vs 类里真实的 override）；
 *  2. 实际 ⇔ 期望 是否一致（expectations.ts 的三态）；
 *  3. 源上有没有「实现了但接口里根本没有」的方法 —— 即被封装埋没的能力。
 *
 * 第 3 点是「榨干每个源的能力」的关键：SourceRouter 只按 DataSourceMethod 分发，
 * 源上任何不在 88 个方法内的公开方法永远不会被路由到（如 StockSdkSource.getBoardQuotes）。
 * 这里把它们自动列出来，作为能力补录的输入。
 */
import type { DataSourceMethod, MarketDataSource } from '@/data/api';
import { BaseMarketDataSource } from '@/data/api/sources/BaseMarketDataSource';
import { ALL_METHODS } from './catalog';
import { expectationOf, noteOf, type ExpectationKind } from './expectations';

export type GapKind =
  | 'declared-but-unsupported' // 声明支持，但期望/实际是不支持（路由会白白尝试）
  | 'declared-but-not-implemented' // 声明了但类里没 override（落到基类 3004）
  | 'missing-supported' // 期望支持，但没声明或没实现（能力断链）
  | 'unexpected-declared' // 期望没有，但源声明了（期望需要同步更新）
  | 'source-only-capability'; // 源有方法，但 88 个接口方法里没有 —— 能力闲置

export interface CapabilityGap {
  kind: GapKind;
  method: string;
  detail: string;
}

export interface SourceAudit {
  sourceId: string;
  label: string;
  /** capabilities 声明数 */
  declaredCount: number;
  /** 类里真实 override 的方法数（不含基类兜底桩） */
  implementedCount: number;
  /** 期望支持的方法数 */
  expectedCount: number;
  /** 接口外方法（能力闲置清单） */
  sourceOnlyMethods: string[];
  gaps: CapabilityGap[];
}

/**
 * 接口元信息与内部成员：不算「能力方法」。
 * 注意：TS 的 private 在运行时与普通方法无异，这里显式登记各源的内部辅助方法
 * （新增内部方法请加到这里，或按约定加 `_` 前缀）。
 */
const NON_METHOD_MEMBERS = new Set([
  // 接口元信息 / 生命周期
  'constructor',
  'id',
  'label',
  'capabilities',
  'supports',
  'init',
  'dispose',
  'getInstance',
  // 基类内部
  'guard',
  'unsupported',
  'spec',
  'sdk',
  // 各源内部辅助
  'get',
  'toQuote',
  'toCandle',
  'mapQuote',
  'reportPeriod',
  'fetchDailyKline',
  'periodToType',
  'toFinancialCommon',
  'boardKlineCN',
  'clearCaches',
]);

/** 是否 override 了基类的兜底实现（基类所有方法都是 3004 桩，引用相同即未实现） */
function isOverridden(src: MarketDataSource, method: string): boolean {
  const own = (src as unknown as Record<string, unknown>)[method];
  const base = (BaseMarketDataSource.prototype as unknown as Record<string, unknown>)[method];
  return typeof own === 'function' && own !== base;
}

/** 收集「源上有、但 88 个接口方法里没有」的公开方法（能力闲置清单） */
function collectSourceOnlyMethods(src: MarketDataSource): string[] {
  const known = new Set<string>(ALL_METHODS);
  const names = new Set<string>();
  let proto: object | null = Object.getPrototypeOf(src);
  while (proto && proto !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(proto)) names.add(n);
    proto = Object.getPrototypeOf(proto);
  }
  return [...names]
    .filter(n => !known.has(n) && !NON_METHOD_MEMBERS.has(n) && !n.startsWith('_'))
    .filter(n => typeof (src as unknown as Record<string, unknown>)[n] === 'function')
    .sort();
}

/** 对单个源做能力审计 */
export function auditSource(src: MarketDataSource): SourceAudit {
  const declared = new Set<DataSourceMethod>(src.capabilities ?? []);
  const gaps: CapabilityGap[] = [];

  let implementedCount = 0;
  for (const m of ALL_METHODS) {
    const isDeclared = declared.has(m);
    const overridden = isOverridden(src, m);
    if (overridden) implementedCount += 1;

    const expected: ExpectationKind = expectationOf(src.id, m);
    const note = noteOf(src.id, m);

    if (expected === 'supported') {
      if (!isDeclared) {
        gaps.push({
          kind: 'missing-supported',
          method: m,
          detail: `期望支持但未声明 capabilities${note ? `（${note}）` : ''}`,
        });
      } else if (!overridden) {
        gaps.push({
          kind: 'declared-but-not-implemented',
          method: m,
          detail: `声明支持但类里没有 override，调用会落到基类 3004${note ? `（${note}）` : ''}`,
        });
      }
    } else if (expected === 'unsupported') {
      if (isDeclared) {
        gaps.push({
          kind: 'declared-but-unsupported',
          method: m,
          detail: `声明支持但期望为不支持（实现是 3004 桩）：应从 capabilities 移除${note ? `（${note}）` : ''}`,
        });
      }
    } else if (isDeclared) {
      gaps.push({
        kind: 'unexpected-declared',
        method: m,
        detail: `期望 ${expected} 但源声明了该方法，请同步更新 expectations${note ? `（${note}）` : ''}`,
      });
    }
  }

  const sourceOnlyMethods = collectSourceOnlyMethods(src);
  for (const m of sourceOnlyMethods) {
    gaps.push({
      kind: 'source-only-capability',
      method: m,
      detail: '源已实现但不在 88 个接口方法内，SourceRouter 永远路由不到 —— 能力闲置，需补录',
    });
  }

  return {
    sourceId: src.id,
    label: src.label,
    declaredCount: declared.size,
    implementedCount,
    expectedCount: ALL_METHODS.filter(m => expectationOf(src.id, m) === 'supported').length,
    sourceOnlyMethods,
    gaps,
  };
}

/** 对多个源做审计（入参为源实例数组） */
export function auditSources(sources: MarketDataSource[]): SourceAudit[] {
  return sources.map(auditSource);
}
