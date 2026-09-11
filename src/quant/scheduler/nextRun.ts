/** 轻量 5 段 cron：分 时 日 月 周。支持 、列表、范围、。*/
export function parseCronField(raw: string, min: number, max: number): number[] | null {
  const text = raw.trim();
  if (!text) return null;
  if (text === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const stepMatch = /^(\*|\d+)(?:-(\d+))?\/(\d+)$/.exec(part);
    if (stepMatch) {
      const start = stepMatch[1] === '*' ? min : Number(stepMatch[1]);
      const end = stepMatch[2] != null ? Number(stepMatch[2]) : max;
      const step = Number(stepMatch[3]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(step) || step <= 0) return null;
      for (let v = start; v <= end; v += step) {
        if (v >= min && v <= max) out.add(v);
      }
      continue;
    }
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part);
    if (rangeMatch) {
      const a = Number(rangeMatch[1]);
      const b = Number(rangeMatch[2]);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a > b) return null;
      for (let v = a; v <= b; v++) {
        if (v >= min && v <= max) out.add(v);
      }
      continue;
    }
    const n = Number(part);
    if (!Number.isFinite(n) || n < min || n > max) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCronExpression(expression: string): {
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  weekdays: number[];
} | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const days = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const weekdays = parseCronField(parts[4], 0, 6);
  if (!minutes || !hours || !days || !months || !weekdays) return null;
  return { minutes, hours, days, months, weekdays };
}

/** 下次 cron 触发（本地时区），最多向前扫 62 天。 */
export function nextCronOccurrence(expression: string, from: Date = new Date()): Date | null {
  const parsed = parseCronExpression(expression);
  if (!parsed) return null;
  const { minutes, hours, days, months, weekdays } = parsed;
  const d = new Date(from.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  for (let i = 0; i < 62 * 24 * 60; i++) {
    if (
      months.includes(d.getMonth() + 1) &&
      days.includes(d.getDate()) &&
      weekdays.includes(d.getDay()) &&
      hours.includes(d.getHours()) &&
      minutes.includes(d.getMinutes())
    ) {
      return new Date(d.getTime());
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

export type ScheduleKind = 'once' | 'interval' | 'cron';

export type ScheduleSpec = {
  run_at?: string;
  every_sec?: number;
  anchor?: string;
  expression?: string;
};

export function computeNextRunAt(
  scheduleKind: ScheduleKind,
  schedule: ScheduleSpec,
  from: Date = new Date(),
  opts?: { afterSuccess?: boolean },
): Date | null {
  if (scheduleKind === 'once') {
    if (opts?.afterSuccess) return null;
    const at = schedule.run_at ? new Date(schedule.run_at) : null;
    if (!at || Number.isNaN(at.getTime())) return null;
    return at.getTime() > from.getTime() ? at : null;
  }
  if (scheduleKind === 'interval') {
    const every = Math.max(30, Math.floor(schedule.every_sec || 0));
    if (!every) return null;
    const anchor = schedule.anchor ? new Date(schedule.anchor) : from;
    const base = Number.isNaN(anchor.getTime()) ? from : anchor;
    let next = base.getTime();
    if (next <= from.getTime()) {
      const elapsed = from.getTime() - next;
      const steps = Math.floor(elapsed / (every * 1000)) + 1;
      next = next + steps * every * 1000;
    }
    return new Date(next);
  }
  if (scheduleKind === 'cron') {
    return schedule.expression ? nextCronOccurrence(schedule.expression, from) : null;
  }
  return null;
}
