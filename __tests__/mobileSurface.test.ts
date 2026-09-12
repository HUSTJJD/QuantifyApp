/**
 * mobile-surface / onboarding 基础纯逻辑单测。
 */
import { digestDayKey } from '@/features/notify/digest';
import { layout, duration, spacing } from '@/theme';

describe('theme layout tokens', () => {
  it('exposes Opptrix-aligned spacing/radius/duration', () => {
    expect(spacing.xxs).toBe(2);
    expect(duration.fast).toBe(120);
    expect(layout.chipHeight).toBe(28);
    expect(layout.rowMinHeight).toBe(48);
  });
});

describe('digestDayKey', () => {
  it('formats by Asia/Shanghai day', () => {
    // 2026-09-12 16:00 UTC+8 ≈ fixed ms
    const ts = Date.parse('2026-09-12T08:00:00.000Z');
    expect(digestDayKey(ts)).toBe('2026-09-12');
  });
});
