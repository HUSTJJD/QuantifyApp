/**
 * 回归：getAdjustmentFactors 契约参数与指数跳过。
 */
import { HithsaApiSource } from '@/api/sources/HithsaApiSource';
import { HithsaHttpClient } from '@/api/sources/HithsaHttpClient';
import { FuyaoApiSource } from '@/api/sources/FuyaoApiSource';
import type { Symbol } from '@/api';

const CN: Symbol = { code: '600519', exchange: 'SH' };
const TI: Symbol = { code: '886042', exchange: 'TI' };
const HK: Symbol = { code: '00700', exchange: 'HK' };

describe('getAdjustmentFactors 契约', () => {
  it('hithsa：参数名 thscodes（不是 symbol）', async () => {
    const get = jest.fn().mockResolvedValue([]);
    const client = { get } as unknown as HithsaHttpClient;
    const src = new HithsaApiSource(client);
    await src.getAdjustmentFactors(CN);
    expect(get).toHaveBeenCalledWith(
      '/api/a-share/corporate-actions/adjustment-factors',
      expect.objectContaining({ thscodes: '600519.SH' }),
    );
    const arg = get.mock.calls[0][1] as Record<string, string>;
    expect(arg.thscode).toBeUndefined();
    expect(arg.symbol).toBeUndefined();
  });

  it('hithsa：指数/港股不请求上游，返回空', async () => {
    const get = jest.fn();
    const src = new HithsaApiSource({ get } as unknown as HithsaHttpClient);
    expect(await src.getAdjustmentFactors(TI)).toEqual([]);
    expect(await src.getAdjustmentFactors(HK)).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it('fuyao：指数/港股不请求上游，返回空', async () => {
    const spy = jest.fn();
    const src = new FuyaoApiSource(() => 'test-key');
    // 未构造 client 前直接调用，应先因指数/港股 short-circuit 返回空
    expect(await src.getAdjustmentFactors(TI)).toEqual([]);
    expect(await src.getAdjustmentFactors(HK)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
