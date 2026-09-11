/**
 * 信号一键跟单单测：
 *  - 买入按资金比例估算整手股数
 *  - 卖出按可用持仓比例估算整手股数
 *  - 资金/持仓不足返回失败
 *  - 跟单写入模拟盘持仓/现金
 */
import { followSignal, estimateFollowQty, markFollowed, loadFollowed } from '@/simulation/follow';
import { SimAccountRepo } from '@/simulation';
import { resetQuantStore } from '@/data/db/QuantStore';
import { MemoryStorageAdapter, setStorage } from '@/data/db/storage';
import type { Symbol } from '@/data/api';

const SYM: Symbol = { code: '600519', exchange: 'SH', name: '贵州茅台' };

describe('followSignal', () => {
  beforeEach(async () => {
    setStorage(new MemoryStorageAdapter());
    resetQuantStore();
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

  it('同一信号重复跟单被去重跳过（不重复下单）', async () => {
    const r1 = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.3 });
    expect(r1.ok).toBe(true);
    const acc1 = await SimAccountRepo.get();
    const r2 = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.3 });
    expect(r2.ok).toBe(false);
    expect(r2.message).toContain('已跟单');
    const acc2 = await SimAccountRepo.get();
    // 持仓不应增加（仍是第一次的数量）
    expect(acc2.positions[0].shares).toBe(acc1.positions[0].shares);
  });

  it('不同方向（买/卖）的信号互不影响，不会被误拦', async () => {
    const rb = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.3 });
    expect(rb.ok).toBe(true);
    // 无持仓，卖出应被拒（但这是持仓不足，不是去重拦截）
    const rs = await followSignal({ symbol: SYM, side: 'sell', price: 10, ratio: 0.3 });
    expect(rs.ok).toBe(false);
    expect(rs.message).toContain('持仓不足');
  });

  it('显式不同 dedupeKey 可重复跟单（绕过去重）', async () => {
    const r1 = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.2, dedupeKey: 'k1' });
    expect(r1.ok).toBe(true);
    const r2 = await followSignal({ symbol: SYM, side: 'buy', price: 10, ratio: 0.2, dedupeKey: 'k2' });
    expect(r2.ok).toBe(true);
    expect((await SimAccountRepo.get()).positions[0].shares).toBeGreaterThan(0);
  });
});
