/**
 * 加自选后短时报价兜底（watchlist-radar-line 宽限）。
 * 15s 内优先用 addedPrice，避免「--」与失败态。
 */
const GRACE_MS = 15_000;
const map = new Map<string, { price: number; at: number }>();

export function setAddedPrice(symbolKey: string, price: number): void {
  map.set(symbolKey, { price, at: Date.now() });
}

export function peekAddedPrice(symbolKey: string): number | null {
  const v = map.get(symbolKey);
  if (!v) return null;
  if (Date.now() - v.at > GRACE_MS) {
    map.delete(symbolKey);
    return null;
  }
  return v.price;
}

export function clearAddedPrice(symbolKey: string): void {
  map.delete(symbolKey);
}
