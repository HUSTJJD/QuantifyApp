/**
 * ApiStabilityStats 单元测试：验证统计聚合逻辑（成功率/延迟/覆盖度/失败原因/评分/排序）。
 */
import { ApiStabilityStats } from '@/api/ApiStabilityStats';
import { DataSourceError } from '@/api/MarketDataSource';

describe('ApiStabilityStats', () => {
  let stats: ApiStabilityStats;
  beforeEach(() => {
    // 每次用例隔离实例
    (ApiStabilityStats as any)._instance = null;
    stats = ApiStabilityStats.getInstance();
  });
  afterEach(() => {
    ApiStabilityStats.reset();
  });

  it('记录成功/失败后计算成功率与平均延迟', () => {
    const ctx = stats.begin('stock-api', 'getQuotes');
    stats.success('stock-api', 'getQuotes', ctx);
    stats.success('stock-api', 'getQuotes', stats.begin('stock-api', 'getQuotes'));

    const ctx2 = stats.begin('stock-sdk', 'getQuotes');
    stats.failure('stock-sdk', 'getQuotes', new DataSourceError('A股行情失败', 'stock-sdk'));

    const s = stats.getStat('stock-api')!;
    expect(s.attempts).toBe(2);
    expect(s.successes).toBe(2);
    expect(s.failures).toBe(0);

    const sdk = stats.getStat('stock-sdk')!;
    expect(sdk.attempts).toBe(1);
    expect(sdk.successes).toBe(0);
    expect(sdk.failures).toBe(1);
    // "A股行情失败" 以"失败"结尾且无上游 code → 归为「行情上游不可用」
    expect(sdk.failureReasons['行情上游不可用']).toBe(1);
  });

  it('覆盖率统计：仅记录曾经成功的 method', () => {
    stats.success('hithsa', 'getQuotes', stats.begin('hithsa', 'getQuotes'));
    stats.failure('hithsa', 'getKline', new DataSourceError('缺能力', 'hithsa'));
    const s = stats.getStat('hithsa')!;
    expect(s.methodsOk['getQuotes']).toBe(true);
    expect(s.methodsOk['getKline']).toBeUndefined();
  });

  it('评分：无尝试为 0；全成功且全覆盖为 100', () => {
    expect(stats.score(stats.getStat('x') ?? ({ attempts: 0 } as any))).toBe(0);
    const ctx = stats.begin('a', 'getQuotes');
    stats.success('a', 'getQuotes', ctx);
    const s = stats.getStat('a')!;
    expect(stats.score(s)).toBe(100);
  });

  it('排序：成功率高的源排在前', () => {
    stats.success('good', 'm', stats.begin('good', 'm'));
    stats.failure('bad', 'm', new DataSourceError('x', 'bad'));
    const all = stats.getAll();
    expect(all[0].id).toBe('good');
  });

  it('失败原因归一化：超时/网络/不支持被归类', () => {
    stats.failure('s', 'm', new DataSourceError('请求超时(1000ms)', 's'));
    stats.failure('s', 'm', new DataSourceError('fetch failed', 's'));
    stats.failure('s', 'm', new DataSourceError('msg', 's', 1002));
    const s = stats.getStat('s')!;
    expect(s.failureReasons['请求超时']).toBe(1);
    expect(s.failureReasons['网络不可达']).toBe(1);
    expect(s.failureReasons['能力不支持(1002/3004)']).toBe(1);
  });

  it('失败原因归一化：底层 cause 的网络断开优先归类', () => {
    // stock-sdk guard 把真实异常塞进 DataSourceError.cause
    const cause = new Error('other side closed (ECONNRESET)');
    const err = new DataSourceError('K线失败', 'stock-sdk', undefined, cause);
    stats.failure('stock-sdk', 'getKline', err);
    const s = stats.getStat('stock-sdk')!;
    expect(s.failureReasons['上游连接失败(网络/断开)']).toBe(1);
  });

  it('失败原因归一化：方法包装失败归为「xx上游不可用」', () => {
    stats.failure('stock-sdk', 'getKline', new DataSourceError('K线失败', 'stock-sdk'));
    const s = stats.getStat('stock-sdk')!;
    expect(s.failureReasons['K线上游不可用']).toBe(1);
  });
});
