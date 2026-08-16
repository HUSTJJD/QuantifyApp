/**
 * 源级熔断：连续真实故障达到阈值后，短时间内不再尝试该源。
 * 「不支持」(3004) 不计入故障。
 */
export interface SourceHealthOptions {
  failureThreshold: number;
  cooldownMs: number;
}

const DEFAULTS: SourceHealthOptions = {
  failureThreshold: 3,
  cooldownMs: 30_000,
};

interface Entry {
  consecutiveFailures: number;
  openUntil: number;
}

export class SourceHealth {
  private readonly opts: SourceHealthOptions;
  private readonly state = new Map<string, Entry>();

  constructor(opts: Partial<SourceHealthOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  isOpen(id: string, now = Date.now()): boolean {
    const e = this.state.get(id);
    if (!e) return false;
    if (e.openUntil > now) return true;
    if (e.openUntil > 0 && e.openUntil <= now) {
      e.openUntil = 0;
      e.consecutiveFailures = 0;
    }
    return false;
  }

  success(id: string): void {
    this.state.set(id, { consecutiveFailures: 0, openUntil: 0 });
  }

  failure(id: string, now = Date.now()): void {
    const prev = this.state.get(id) ?? { consecutiveFailures: 0, openUntil: 0 };
    const consecutiveFailures = prev.consecutiveFailures + 1;
    const openUntil =
      consecutiveFailures >= this.opts.failureThreshold ? now + this.opts.cooldownMs : 0;
    this.state.set(id, { consecutiveFailures, openUntil });
  }

  reset(): void {
    this.state.clear();
  }
}
