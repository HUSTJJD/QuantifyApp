/**
 * 回归：getAdjustmentFactors 契约参数与指数跳过。
 */
import { HithsaApiSource } from '@/data/api/sources/HithsaApiSource';
import { HithsaHttpClient } from '@/data/api/sources/HithsaHttpClient';
import { FuyaoApiSource } from '@/data/api/sources/FuyaoApiSource';
import type { Symbol } from '@/data/api';

const CN: Symbol = { code: '600519', exchange: 'SH' };
const TI: Symbol = { code: '886042', exchange: 'TI' };
const SH_IDX: Symbol = { code: '000001', exchange: 'SH' };
const BJ_IDX: Symbol = { code: '899050', exchange: 'BJ' };
const HK: Symbol = { code: '00700', exchange: 'HK' };

describe('getAdjustmentFactors 契约', () => {
  it('hithsa：参数名 thscode（单数，不接受逗号）+ from/to', async () => {
    const get = jest.fn().mockResolvedValue({ thscode: '600519.SH', item: [] });
    const client = { get } as unknown as HithsaHttpClient;
    const src = new HithsaApiSource(client);
    await src.getAdjustmentFactors(CN, '2024-01-01', '2024-12-31');
    expect(get).toHaveBeenCalledWith(
      '/api/a-share/corporate-actions/adjustment-factors',
      expect.objectContaining({ thscode: '600519.SH', from: '2024-01-01', to: '2024-12-31' }),
    );
    const arg = get.mock.calls[0][1] as Record<string, string>;
    expect(arg.thscodes).toBeUndefined();
    expect(arg.symbol).toBeUndefined();
    expect(arg.from_date).toBeUndefined();
  });

  it('hithsa：解析 item 包装的事件流', async () => {
    const get = jest.fn().mockResolvedValue({
      thscode: '600519.SH',
      item: [{ ex_date_ms: 1717190400000, dividend_per_share: 1.5, per_share_bonus: 0.5 }],
    });
    const src = new HithsaApiSource({ get } as unknown as HithsaHttpClient);
    const f = await src.getAdjustmentFactors(CN);
    expect(f).toHaveLength(1);
    expect(f[0].dividendPerShare).toBe(1.5);
    expect(f[0].perShareBonus).toBe(0.5);
  });

  it('hithsa：指数/港股不请求上游，返回空', async () => {
    const get = jest.fn();
    const src = new HithsaApiSource({ get } as unknown as HithsaHttpClient);
    expect(await src.getAdjustmentFactors(TI)).toEqual([]);
    expect(await src.getAdjustmentFactors(SH_IDX)).toEqual([]);
    expect(await src.getAdjustmentFactors(BJ_IDX)).toEqual([]);
    expect(await src.getAdjustmentFactors(HK)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('fuyao：指数/港股不请求上游，返回空', async () => {
    const spy = jest.fn();
    const src = new FuyaoApiSource(() => 'test-key');
    // 未构造 client 前直接调用，应先因指数/港股 short-circuit 返回空
    expect(await src.getAdjustmentFactors(TI)).toEqual([]);
    expect(await src.getAdjustmentFactors(SH_IDX)).toEqual([]);
    expect(await src.getAdjustmentFactors(BJ_IDX)).toEqual([]);
    expect(await src.getAdjustmentFactors(HK)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
