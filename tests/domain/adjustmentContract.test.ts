/**
 * 回归：getAdjustmentFactors 契约参数与指数跳过。
 */
import { FuyaoApiSource } from '@/data/api/sources/FuyaoApiSource';
import type { Symbol } from '@/data/api';

const CN: Symbol = { code: '600519', exchange: 'SH' };
const TI: Symbol = { code: '886042', exchange: 'TI' };
const SH_IDX: Symbol = { code: '000001', exchange: 'SH' };
const HK: Symbol = { code: '00700', exchange: 'HK' };

describe('getAdjustmentFactors 契约', () => {
  it('fuyao：指数/港股不请求上游，返回空', async () => {
    const src = new FuyaoApiSource(() => 'test-key');
    // 未构造 client 前直接调用，应先因指数/港股 short-circuit 返回空
    expect(await src.getAdjustmentFactors(TI)).toEqual([]);
    expect(await src.getAdjustmentFactors(SH_IDX)).toEqual([]);
    expect(await src.getAdjustmentFactors(HK)).toEqual([]);
  });
});
