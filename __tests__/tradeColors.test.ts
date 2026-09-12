/**
 * 涨跌色方案单测。
 */
import { getColors } from '@/theme';

describe('getColors upDownScheme', () => {
  it('cn keeps red-up green-down', () => {
    const dark = getColors('dark', 'cn');
    expect(dark.up).toBe('#F5465C');
    expect(dark.down).toBe('#2DCB73');
  });

  it('intl swaps up/down', () => {
    const base = getColors('dark', 'cn');
    const intl = getColors('dark', 'intl');
    expect(intl.up).toBe(base.down);
    expect(intl.down).toBe(base.up);
  });

  it('colorblind uses blue/orange', () => {
    const cb = getColors('dark', 'colorblind');
    expect(cb.up).toBe('#60A5FA');
    expect(cb.down).toBe('#FB923C');
  });
});
