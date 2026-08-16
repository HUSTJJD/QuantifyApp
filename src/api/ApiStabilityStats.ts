/**
 * API 稳定性统计。
 *
 * 在 MarketDataClient 每次「尝试某源 / 成功 / 失败」时由 record* 写入，
 * 用于评估各数据源的：可用性（成功率）、稳定性（延迟分布）、覆盖度（哪些方法能拿到数据）。
 *
 * 设计：
 *  - 进程内内存统计（不落盘），App 重启清零——足够评估“当前网络/实现下哪个源更全更稳”；
 *  - 数据驱动 UI（ApiStatsScreen），无需额外状态库；
 *  - 统计维度：每源 总尝试 / 成功 / 失败 / 平均延迟 / 失败原因分布 / 各方法成功标志。
 */
import { DataSourceError } from './MarketDataSource';

export type SourceId = string;
export type MethodKey = string;

export interface SourceStat {
  id: SourceId;
  label: string;
  attempts: number;
  successes: number;
  failures: number;
  /** 成功请求的总耗时（ms），用于算平均延迟 */
  successLatencySum: number;
  /** 最近一次成功的耗时（ms），-1 表示从未成功 */
  lastSuccessLatency: number;
  /** 失败原因计数：key 为归一化的错误描述 */
  failureReasons: Record<string, number>;
  /** 各方法是否曾经成功过（覆盖度）：method -> true */
  methodsOk: Record<MethodKey, boolean>;
}

export interface ErrorInfo {
  sourceId: SourceId;
  method: MethodKey;
  /** 归一化错误描述，用于聚合失败原因 */
  reason: string;
  retryable: boolean;
  upstreamCode?: number;
}

function normalizeReason(err: unknown, method: MethodKey): { reason: string; retryable: boolean; upstreamCode?: number } {
  const rawMsg = err instanceof Error ? err.message : String(err);
  // DataSourceError 构造时会在 message 前加 "[sourceId] " 前缀，这里剥离以得到干净原因
  const msg = rawMsg.replace(/^\[[^\]]+\]\s*/, '');
  const code = err instanceof DataSourceError ? err.upstreamCode : undefined;
  const retryable = err instanceof DataSourceError ? err.retryable : true;
  // 原始底层错误（如 stock-sdk 的 guard 会把真实异常塞进 DataSourceError.cause）
  const causeMsg = err instanceof DataSourceError && err.cause instanceof Error ? err.cause.message : '';

  // 0) 优先从底层 cause 识别真实网络故障（stock-sdk 上游 host 常主动断开）
  if (/fetch failed|ECONN|socket|other side closed|reset|timed?out|超时/i.test(causeMsg)) {
    return { reason: '上游连接失败(网络/断开)', retryable: true, upstreamCode: toNum(code) };
  }

  // 1) 再按消息内容归类（超时/网络/标的不支持），对 DataSourceError 与普通错误统一生效
  if (/timeout|超时/i.test(msg)) return { reason: '请求超时', retryable: true, upstreamCode: toNum(code) };
  if (/fetch failed|network|networkerror|莫名|ECONN|socket/i.test(msg)) return { reason: '网络不可达', retryable: true, upstreamCode: toNum(code) };
  if (/unknown thscode|not found|未找到|找不到/i.test(msg)) return { reason: '标的/代码不支持', retryable: false, upstreamCode: toNum(code) };
  // 源内部把业务方法失败包装成"K线失败/行情失败"等，且无上游 code（多为上游不稳定）→ 归为上游不可用
  if (/K线失败|行情失败|盘口失败|失败$/.test(msg) && code === undefined) {
    return { reason: `${methodLabel(method)}上游不可用`, retryable: true, upstreamCode: undefined };
  }

  // 2) 无法按消息归类时，再按上游 code 归类（1002/3004=能力不支持；其余=上游错误）
  if (code === 1002 || code === 3004) return { reason: '能力不支持(1002/3004)', retryable, upstreamCode: toNum(code) };
  if (code !== undefined) return { reason: `上游错误(${code})`, retryable, upstreamCode: toNum(code) };

  return { reason: msg.slice(0, 80) || '未知错误', retryable: false };
}

/** 把方法 key 翻译成可读中文，用于失败原因展示 */
function methodLabel(method: MethodKey): string {
  const map: Record<string, string> = {
    getKline: 'K线',
    getIndexKline: '指数K线',
    getQuotes: '行情',
    getIndexQuotes: '指数行情',
    getOrderBook: '盘口',
  };
  return map[method] ?? method;
}

function toNum(code: number | string | undefined): number | undefined {
  return code === undefined ? undefined : Number(code);
}

export class ApiStabilityStats {
  private static _instance: ApiStabilityStats | null = null;
  private stats = new Map<SourceId, SourceStat>();
  private labels = new Map<SourceId, string>();

  static getInstance(): ApiStabilityStats {
    if (!this._instance) this._instance = new ApiStabilityStats();
    return this._instance;
  }
  static reset(): void {
    this._instance?.clear();
    this._instance = null;
  }

  registerSource(id: SourceId, label: string): void {
    this.labels.set(id, label);
    if (!this.stats.has(id)) {
      this.stats.set(id, this.blank(id, label));
    }
  }

  private blank(id: SourceId, label: string): SourceStat {
    return {
      id,
      label: label || id,
      attempts: 0,
      successes: 0,
      failures: 0,
      successLatencySum: 0,
      lastSuccessLatency: -1,
      failureReasons: {},
      methodsOk: {},
    };
  }

  /** 一次尝试开始（计数 + 返回上下文供结束时结算） */
  begin(sourceId: SourceId, method: MethodKey): { t0: number } {
    this.registerSource(sourceId, sourceId);
    const s = this.stats.get(sourceId)!;
    s.attempts += 1;
    return { t0: Date.now() };
  }

  /** 成功结算 */
  success(sourceId: SourceId, method: MethodKey, ctx: { t0: number }): void {
    this.registerSource(sourceId, sourceId);
    const s = this.stats.get(sourceId)!;
    const latency = Date.now() - ctx.t0;
    s.successes += 1;
    s.successLatencySum += latency;
    s.lastSuccessLatency = latency;
    if (method) s.methodsOk[method] = true;
  }

  /** 失败结算 */
  failure(sourceId: SourceId, method: MethodKey, err: unknown): void {
    this.registerSource(sourceId, sourceId);
    const s = this.stats.get(sourceId)!;
    s.failures += 1;
    const { reason } = normalizeReason(err, method);
    s.failureReasons[reason] = (s.failureReasons[reason] ?? 0) + 1;
  }

  /** 直接记录一个完整结果（成功/失败），便于外部一次性调用 */
  record(sourceId: SourceId, method: MethodKey, ok: boolean, err: unknown, ctx: { t0: number }): void {
    if (ok) this.success(sourceId, method, ctx);
    else this.failure(sourceId, method, err);
  }

  getStat(sourceId: SourceId): SourceStat | undefined {
    return this.stats.get(sourceId);
  }

  /** 所有已注册源的统计（按成功率降序，成功率相同按平均延迟升序） */
  getAll(): SourceStat[] {
    return [...this.stats.values()].sort((a, b) => {
      const ra = a.attempts ? a.successes / a.attempts : 0;
      const rb = b.attempts ? b.successes / b.attempts : 0;
      if (rb !== ra) return rb - ra;
      const la = a.successes ? a.successLatencySum / a.successes : Infinity;
      const lb = b.successes ? b.successLatencySum / b.successes : Infinity;
      return la - lb;
    });
  }

  /** 综合评分（0~100）：成功率 70% + 覆盖度 30%，无尝试则 0 */
  score(s: SourceStat): number {
    if (s.attempts === 0) return 0;
    const successRate = s.successes / s.attempts;
    const coverage = Object.keys(s.methodsOk).length
      ? Object.values(s.methodsOk).filter(Boolean).length / Object.keys(s.methodsOk).length
      : 0;
    return Math.round(successRate * 70 + coverage * 30);
  }

  clear(): void {
    for (const [id, s] of this.stats) this.stats.set(id, this.blank(id, s.label));
  }
}

export const apiStats = ApiStabilityStats.getInstance();
