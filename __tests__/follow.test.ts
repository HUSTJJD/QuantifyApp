/**
 * 信号一键跟单单测：
 *  - 买入按资金比例估算整手股数
 *  - 卖出按可用持仓比例估算整手股数
 *  - 资金/持仓不足返回失败
 *  - 跟单写入模拟盘持仓/现金
 */
import { followSignal, estimateFollowQty, markFollowed, loadFollowed } from '@/simulation/follow';
import { SimAccountRepo } from '@/simulation';
import type { Symbol } from '@/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

describe('followSignal', () => {
  beforeEach(async () => {
    await SimAccountRepo.reset(100_000);
  });

  it('买入按资金比例估算整手股数', () => {
    const acc = { cash: 100_000, positions: [] };
    // price=10, perShare≈10*1.00025+5+10*0.0001≈15.01; budget=100000*0.5=50000; qty=floor(50000/15.01)=3331->3300
    const qty = estimateFollowQty(acc as any, SYM, 'buy', 10, 0.5);
    expect(qty).toBeGreaterThan(0);
    expect(qty % 100).toBe(0);
  });

  it('卖出按可用持仓比例估算整手股数', () => {
    const acc = { cash: 0, positions: [{ symbol: SYM, available: 1000 }] };
    const qty = estimateFollowQty(acc as any, SYM, 'sell', 10, 0.5);
    expect(qty).toBe(500);
  });

  it('跟单买入成功并写入持仓', async () => {
    const res = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.5 });
    expect(res.ok).toBe(true);
    expect(res.qty).toBeGreaterThan(0);
    const acc = await SimAccountRepo.get();
    expect(acc.positions.length).toBe(1);
    expect(acc.cash).toBeLessThan(100_000);
  });

  it('跟单卖出无持仓时失败', async () => {
    const res = await followSignal({ symbol: SYM, side: 'sell', price: 10, ratio: 0.5 });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('持仓不足');
  });

  it('跟单记录持久化防重', async () => {
    await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.3 });
    await markFollowed('600519.SH_buy');
    const set = await loadFollowed();
    expect(set.has('600519.SH_buy')).toBe(true);
  });
});
