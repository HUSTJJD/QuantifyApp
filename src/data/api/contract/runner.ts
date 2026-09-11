/**
 * contract/runner.ts —— 契约执行器（Jest 与 App 内自检共用同一套逻辑）。
 *
 * 两类执行：
 *  1. probeUnsupportedSemantics：对「期望不支持」的方法，断言调用必须抛 DataSourceError(3004)。
 *     防止用「返回空数组/空对象」冒充成功 —— 那会让 SourceRouter 误判为"该源可用"而停止兜底。
 *  2. runSmoke：对「期望支持」且有夹具的方法，真实调用并用 catalog 的结果契约断言校验。
 *     调用入口可注入（Jest 注入 mock 后端，UI 注入 marketData.probeSource），两侧共用同一断言。
 */
import type { DataSourceMethod, MarketDataSource } from '@/data/api';
import { DataSourceError } from '@/data/api/MarketDataSource';
import { ALL_METHODS, METHOD_CATALOG, type MethodCatalogEntry } from './catalog';
import { expectationOf } from './expectations';

export type ContractStatus = 'pass' | 'fail' | 'unsupported' | 'absent' | 'skipped';

export interface ContractRow {
  method: DataSourceMethod;
  label: string;
  status: ContractStatus;
  /** 说明 / 失败原因 */
  detail?: string;
  latencyMs?: number;
  /** 结果条数（-1 表示非数组结果） */
  count?: number;
}

function isUnsupportedError(e: unknown): boolean {
  return e instanceof DataSourceError && e.isUnsupported;
}

function countOf(res: unknown): number {
  if (Array.isArray(res)) return res.length;
  return res == null ? 0 : -1;
}

/**
 * 语义探测：期望非 supported 的方法，必须抛 3004（或源根本没有该方法）。
 * 不注入调用器 —— 直接对源实例调用，这类方法不会发网络请求。
 */
export async function probeUnsupportedSemantics(src: MarketDataSource): Promise<ContractRow[]> {
  const targets = ALL_METHODS.filter(m => expectationOf(src.id, m) !== 'supported');
  const rows: ContractRow[] = [];

  for (const m of targets) {
    const entry: MethodCatalogEntry = METHOD_CATALOG[m];
    const fn = (src as unknown as Record<string, unknown>)[m];

    if (typeof fn !== 'function') {
      rows.push({ method: m, label: entry.label, status: 'absent', detail: '源未提供该方法' });
      continue;
    }

    const args = entry.buildArgs ? entry.buildArgs() : [];
    try {
      const res = await (fn as (...a: unknown[]) => Promise<unknown>).apply(src, args);
      rows.push({
        method: m,
        label: entry.label,
        status: 'fail',
        detail: `期望抛 3004，实际返回了${Array.isArray(res) ? `数组(${res.length})` : typeof res}（空结果冒充成功会让路由误判）`,
      });
    } catch (e) {
      if (isUnsupportedError(e)) {
        rows.push({ method: m, label: entry.label, status: 'unsupported', detail: '3004 正确兜底' });
      } else {
        rows.push({
          method: m,
          label: entry.label,
          status: 'fail',
          detail: `期望 3004，实际抛出：${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  }
  return rows;
}

export interface SmokeOptions {
  /** 只跑指定方法（缺省 = 全部期望支持且有夹具的） */
  methods?: DataSourceMethod[];
  /**
   * 调用入口。默认直接对源调用（Jest 里源已被 mock 后端包裹）。
   * UI 侧传 marketData.probeSource 走既有封装，保证测的是同一条业务链路。
   */
  call?: (method: DataSourceMethod, args: unknown[]) => Promise<unknown>;
  /** 进度回调 */
  onProgress?: (done: number, total: number) => void;
}

/** 冒烟：对期望支持的方法真实调用 + 结果契约断言 */
export async function runSmoke(src: MarketDataSource, opts: SmokeOptions = {}): Promise<ContractRow[]> {
  const call =
    opts.call ??
    (async (m: DataSourceMethod, args: unknown[]) => {
      const fn = (src as unknown as Record<string, unknown>)[m];
      if (typeof fn !== 'function') throw new Error(`源未提供方法 ${m}`);
      return (fn as (...a: unknown[]) => Promise<unknown>).apply(src, args);
    });

  const targets = (opts.methods ?? ALL_METHODS).filter(m => {
    if (expectationOf(src.id, m) !== 'supported') return false;
    const entry: MethodCatalogEntry = METHOD_CATALOG[m];
    return !!entry.buildArgs;
  });

  const rows: ContractRow[] = [];
  let done = 0;
  for (const m of targets) {
    const entry: MethodCatalogEntry = METHOD_CATALOG[m];
    const started = Date.now();
    try {
      // 目录项是 88 个方法的联合类型，取夹具/断言时统一收敛到未类型化签名（动态分发边界）
      const buildArgs = entry.buildArgs as unknown as () => unknown[];
      const assertResult = entry.assertResult as unknown as ((r: unknown) => string | null) | undefined;
      const res = await call(m, buildArgs());
      const err = assertResult ? assertResult(res) : null;
      rows.push({
        method: m,
        label: entry.label,
        status: err ? 'fail' : 'pass',
        detail: err ?? undefined,
        latencyMs: Date.now() - started,
        count: countOf(res),
      });
    } catch (e) {
      rows.push({
        method: m,
        label: entry.label,
        status: 'fail',
        detail: e instanceof Error ? e.message : String(e),
        latencyMs: Date.now() - started,
      });
    }
    done += 1;
    opts.onProgress?.(done, targets.length);
  }
  return rows;
}
