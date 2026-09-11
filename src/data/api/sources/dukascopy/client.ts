/**
 * Dukascopy HTTP 客户端（RN 兼容，协议对齐 vendor/dukascopy-node）。
 *
 * 数据端点：https://jetta.dukascopy.com/v1
 * 日线：/candles/day/{CODE}/BID/{year}[?from=ms]
 * 分钟：/candles/minute/{CODE}/BID/{year}/{month}/{day}[?from=ms]
 *
 * 响应为差分压缩 JSON（base + multiplier + delta columns），
 * 此处实现与 dukascopy-node data-normaliser 同构的解码，不依赖 Node Buffer。
 */

/** 与 dukascopy-node/src/config/data-api.ts 一致（jetta） */
export const DUKASCOPY_API_ROOT = 'https://jetta.dukascopy.com/v1';

export interface DukascopyCandlePoint {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CandleResponse {
  timestamp: number;
  multiplier: number;
  shift: number;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  times: number[];
  opens: number[];
  highs: number[];
  lows: number[];
  closes: number[];
  volumes: number[];
}

function priceScale(multiplier: number): number {
  if (!Number.isFinite(multiplier) || multiplier <= 0) return 5;
  const [coeff, expText = '0'] = multiplier.toString().toLowerCase().split('e');
  const decimals = coeff.split('.')[1]?.length ?? 0;
  const exp = Number(expText);
  return Math.max(0, decimals - (Number.isFinite(exp) ? exp : 0));
}

function formatPrice(units: number, multiplier: number, scale: number): number {
  return Number((units * multiplier).toFixed(scale));
}

/** 解码 Dukascopy 差分蜡烛响应 → OHLC 数组 */
export function decodeCandles(data: CandleResponse): DukascopyCandlePoint[] {
  if (!data || !Array.isArray(data.times) || !Number.isFinite(data.timestamp)) return [];
  const length = data.times.length;
  if (length === 0) return [];
  if (
    typeof data.open !== 'number' ||
    typeof data.high !== 'number' ||
    typeof data.low !== 'number' ||
    typeof data.close !== 'number' ||
    !Number.isFinite(data.shift) ||
    data.shift <= 0
  ) {
    return [];
  }

  const scale = priceScale(data.multiplier);
  let timestamp = data.timestamp;
  let openU = Math.round(data.open / data.multiplier);
  let highU = Math.round(data.high / data.multiplier);
  let lowU = Math.round(data.low / data.multiplier);
  let closeU = Math.round(data.close / data.multiplier);
  const out: DukascopyCandlePoint[] = [];

  for (let i = 0; i < length; i++) {
    timestamp += data.times[i] * data.shift;
    openU += data.opens[i] ?? 0;
    highU += data.highs[i] ?? 0;
    lowU += data.lows[i] ?? 0;
    closeU += data.closes[i] ?? 0;
    out.push({
      timestamp,
      open: formatPrice(openU, data.multiplier, scale),
      high: formatPrice(highU, data.multiplier, scale),
      low: formatPrice(lowU, data.multiplier, scale),
      close: formatPrice(closeU, data.multiplier, scale),
      volume: data.volumes?.[i] ?? 0,
    });
  }
  return out;
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<CandleResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`dukascopy HTTP ${res.status}`);
    }
    const text = await res.text();
    if (!text) return { timestamp: 0, multiplier: 1, shift: 1, open: null, high: null, low: null, close: null, times: [], opens: [], highs: [], lows: [], closes: [], volumes: [] };
    return JSON.parse(text) as CandleResponse;
  } finally {
    clearTimeout(timer);
  }
}

/** 当年 / 指定年日线 URL（含进行中 bucket 的 ?from=） */
export function dayCandlesUrl(instrumentCode: string, year: number, fromMs?: number): string {
  const base = `${DUKASCOPY_API_ROOT}/candles/day/${instrumentCode}/BID/${year}`;
  return fromMs != null ? `${base}?from=${fromMs}` : base;
}

/** 拉取日线（默认最近 2 个自然年，覆盖跨年昨收） */
export async function fetchDayCandles(
  instrumentCode: string,
  opts?: { years?: number; now?: Date },
): Promise<DukascopyCandlePoint[]> {
  const now = opts?.now ?? new Date();
  const years = opts?.years ?? 2;
  const urls: string[] = [];
  for (let y = now.getUTCFullYear(); y > now.getUTCFullYear() - years; y--) {
    urls.push(dayCandlesUrl(instrumentCode, y));
  }
  const results = await Promise.all(urls.map((u) => fetchJson(u).then(decodeCandles)));
  const all = results.flat().sort((a, b) => a.timestamp - b.timestamp);
  // 同 ts 去重
  const map = new Map<number, DukascopyCandlePoint>();
  for (const c of all) map.set(c.timestamp, c);
  return [...map.values()];
}

/** 拉取某日分钟线（进行中交易日用 ?from=） */
export async function fetchMinuteCandles(
  instrumentCode: string,
  day: Date = new Date(),
): Promise<DukascopyCandlePoint[]> {
  const y = day.getUTCFullYear();
  const m = day.getUTCMonth() + 1;
  const d = day.getUTCDate();
  const base = `${DUKASCOPY_API_ROOT}/candles/minute/${instrumentCode}/BID/${y}/${m}/${d}`;
  const startUtc = Date.UTC(y, m - 1, d);
  const data = await fetchJson(`${base}?from=${startUtc}`);
  return decodeCandles(data);
}
