/**
 * regime 判定单测。
 */
import { detectRegime, REGIME_PRESETS } from '@/quant/regime';

describe('detectRegime', () => {
  it('panic when limit-down dominates', () => {
    const r = detectRegime({ limitUpCount: 10, limitDownCount: 40, indexPct: -1.2 });
    expect(r.regime).toBe('panic');
  });

  it('euphoria when limit-up dominates', () => {
    const r = detectRegime({ limitUpCount: 50, limitDownCount: 8, indexPct: 1.1 });
    expect(r.regime).toBe('euphoria');
  });

  it('neutral without extremes', () => {
    const r = detectRegime({ limitUpCount: 30, limitDownCount: 25, indexPct: 0.2 });
    expect(r.regime).toBe('neutral');
  });

  it('unknown without data', () => {
    expect(detectRegime({}).regime).toBe('unknown');
  });

  it('presets cover all known regimes', () => {
    expect(REGIME_PRESETS.panic.templateIds.length).toBeGreaterThan(0);
    expect(REGIME_PRESETS.euphoria.templateIds).toContain('breakout_momentum');
  });
});
