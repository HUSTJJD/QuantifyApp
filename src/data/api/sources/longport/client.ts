/**
 * Longport（长桥）OpenAPI HTTP 客户端 —— 从上层 `ThirdPart/longport_mcp/longport_mcp_web.py`
 * 的已验证 LongportClient 移植（签名算法 / 端点 / 参数排序一致）。
 *
 * npm `longbridge` 为 Node 原生扩展，不能进 RN；此处用 fetch + 同一套 HTTP 签名。
 * 文档：https://open.longportapp.com/en/docs
 */
import { hmacSha256Hex, sha1Hex } from './crypto';

export const LONGPORT_HTTP_BASE = 'https://openapi.longportapp.com';

export interface LongportCredentials {
  appKey: string;
  appSecret: string;
  accessToken: string;
}

export interface LongportQuote {
  symbol: string;
  lastDone: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  turnover: number;
  change?: number;
  changePct?: number;
  updatedAtMs?: number;
}

export interface LongportCandle {
  timestampMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  turnover: number;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 签名（与 longport_mcp_web.py 一致）：
 * 1. headers_str = "authorization:{token}\nx-api-key:{key}\nx-timestamp:{ts}\n"
 * 2. canonical = "{METHOD}|{URI}|{PARAMS}|{headers_str}|{signed_headers}|{payload_hash}"
 * 3. sign_str = "HMAC-SHA256|" + SHA1(canonical)
 * 4. signature = HMAC-SHA256_HEX(app_secret, sign_str)
 */
function buildHeaders(
  cred: LongportCredentials,
  method: string,
  uri: string,
  params: string,
  body: string,
): Record<string, string> {
  const timestamp = String(Date.now() / 1000);
  const headersStr = `authorization:${cred.accessToken}\nx-api-key:${cred.appKey}\nx-timestamp:${timestamp}\n`;
  const signedHeaders = 'authorization;x-api-key;x-timestamp';
  const payloadHash = body ? sha1Hex(body) : '';
  const canonical = `${method.toUpperCase()}|${uri}|${params}|${headersStr}|${signedHeaders}|${payloadHash}`;
  const signStr = 'HMAC-SHA256|' + sha1Hex(canonical);
  const signature = hmacSha256Hex(cred.appSecret, signStr);
  return {
    'X-Api-Key': cred.appKey,
    Authorization: cred.accessToken,
    'X-Timestamp': timestamp,
    'X-Api-Signature': `HMAC-SHA256 SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

/** 查询串：滤空 + 键名字典序（与 Python sorted_params 一致） */
function encodeParams(params?: Record<string, string | number | undefined | null>): string {
  if (!params) return '';
  const pairs = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => [k, String(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

async function requestRaw(
  cred: LongportCredentials,
  method: 'GET' | 'POST',
  endpoint: string,
  params?: Record<string, string | number | undefined | null>,
  bodyObj?: unknown,
  timeoutMs = 15_000,
): Promise<unknown> {
  const paramsStr = encodeParams(params);
  const body = bodyObj != null ? JSON.stringify(bodyObj) : '';
  const headers = buildHeaders(cred, method, endpoint, paramsStr, body);
  const url = `${LONGPORT_HTTP_BASE}${endpoint}${paramsStr ? `?${paramsStr}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : body,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: { code?: number; message?: string; data?: unknown } | null = null;
    try {
      json = JSON.parse(text) as { code?: number; message?: string; data?: unknown };
    } catch {
      throw new Error(`longport 响应非 JSON (${res.status})`);
    }
    if (!res.ok) throw new Error(`longport HTTP ${res.status} ${text.slice(0, 120)}`);
    if (json.code != null && json.code !== 0) {
      throw new Error(`longport API错误[${json.code}]: ${json.message ?? ''}`);
    }
    return json.data ?? json;
  } finally {
    clearTimeout(timer);
  }
}

/** GET /v1/quote?symbol=AAPL.US,700.HK */
export async function fetchLongportQuotes(
  cred: LongportCredentials,
  symbols: string[],
): Promise<LongportQuote[]> {
  if (symbols.length === 0) return [];
  const raw = await requestRaw(cred, 'GET', '/v1/quote', { symbol: symbols.join(',') });
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { list?: unknown[] })?.list)
    ? ((raw as { list: unknown[] }).list)
    : [];
  return list.map((item) => {
    const r = item as Record<string, unknown>;
    const lastDone = num(r.last_done ?? r.lastDone ?? r.price);
    const prevClose = num(r.prev_close ?? r.prevClose);
    const open = num(r.open);
    const high = num(r.high);
    const low = num(r.low);
    const change = r.change != null ? num(r.change) : lastDone - prevClose;
    const changePct =
      r.change_pct != null
        ? num(r.change_pct)
        : r.changePercent != null
          ? num(r.changePercent)
          : prevClose
            ? (change / prevClose) * 100
            : 0;
    return {
      symbol: String(r.symbol ?? ''),
      lastDone,
      prevClose,
      open,
      high,
      low,
      volume: num(r.volume),
      turnover: num(r.turnover),
      change,
      changePct,
      updatedAtMs: Date.now(),
    };
  });
}

/** 周期：1m/5m/…/1d → 上游数字 period（1/5/…/1000） */
export function mapLongportPeriod(period: string): number {
  const map: Record<string, number> = {
    '1m': 1,
    '5m': 5,
    '15m': 15,
    '30m': 30,
    '60m': 60,
    '1d': 1000,
    '1w': 2000,
    '1M': 3000,
  };
  return map[period] ?? (period && /^\d+$/.test(period) ? Number(period) : 1000);
}

/** GET /v1/quote/candlestick */
export async function fetchLongportCandles(
  cred: LongportCredentials,
  symbol: string,
  period = '1d',
  count = 200,
  adjustType = 0,
): Promise<LongportCandle[]> {
  const raw = await requestRaw(cred, 'GET', '/v1/quote/candlestick', {
    symbol,
    period: String(mapLongportPeriod(period)),
    count: String(Math.min(count, 1000)),
    adjust_type: String(adjustType),
  });
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { list?: unknown[] })?.list)
      ? (raw as { list: unknown[] }).list
      : [];
  return list.map((item) => {
    const r = item as Record<string, unknown>;
    const ts = num(r.timestamp ?? r.time);
    return {
      timestampMs: ts > 1e12 ? ts : ts * 1000,
      open: num(r.open),
      high: num(r.high),
      low: num(r.low),
      close: num(r.close),
      volume: num(r.volume),
      turnover: num(r.turnover),
    };
  });
}

export function hasLongportCreds(cred?: Partial<LongportCredentials> | null): cred is LongportCredentials {
  return !!(cred?.appKey && cred?.appSecret && cred?.accessToken);
}
