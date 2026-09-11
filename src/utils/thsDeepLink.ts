/**
 * 同花顺 App 深链（10jqka://）构建与拉起。
 *
 * 协议（公开跳转，兼容性较稳定）：
 *  - 个股详情  10jqka://stock/detail?code={6位代码}
 *  - 大盘指数  10jqka://market/index?code={指数代码}
 *  - 板块行情  10jqka://plate/detail?code={板块代码}
 *  - 自选股    10jqka://portfolio/my
 *  - 人气热榜  10jqka://market/hotlist
 *  - 智能盯盘  10jqka://monitor/home
 *  - 智能诊股  10jqka://stock/analyze?code={6位代码}
 *
 * 使用约定：
 *  - 只拼 URL / 调 Linking，不依赖业务状态，可被 UI 与跟单流程共用；
 *  - 未安装同花顺时 openURL 可能 reject，调用方自行决定是否提示；
 *  - 港股/美股代码原样透传（App 内是否识别取决于同花顺版本）。
 */
import { Linking, Platform } from 'react-native';
import type { Symbol } from '@/data/api';
import { isIndexSymbol } from '@/domain/symbol';

export const THS_SCHEME = '10jqka';

/** 同花顺深链目标页 */
export type ThsPage =
  | 'stockDetail'
  | 'index'
  | 'board'
  | 'watchlist'
  | 'hotlist'
  | 'monitor'
  | 'analyze';

const PATH: Record<ThsPage, string> = {
  stockDetail: 'stock/detail',
  index: 'market/index',
  board: 'plate/detail',
  watchlist: 'portfolio/my',
  hotlist: 'market/hotlist',
  monitor: 'monitor/home',
  analyze: 'stock/analyze',
};

/** 去掉交易所后缀，得到同花顺跳转用的裸代码（600519 / 00700 / BK1027） */
export function thsJumpCode(symbol: Symbol): string {
  return symbol.code.replace(/\.[A-Z]{2}$/i, '');
}

/**
 * 按标的自动选页：
 *  - TI / BK* 板块 → plate/detail
 *  - 指数（isIndexSymbol）→ market/index
 *  - 其余 → stock/detail
 */
export function resolveThsPage(symbol: Symbol): ThsPage {
  const code = thsJumpCode(symbol);
  if (symbol.exchange === 'TI' || /^BK\d+$/i.test(code)) return 'board';
  if (isIndexSymbol(symbol)) return 'index';
  return 'stockDetail';
}

function build(page: ThsPage, code?: string): string {
  const path = PATH[page];
  if (code === undefined) return `${THS_SCHEME}://${path}`;
  return `${THS_SCHEME}://${path}?code=${encodeURIComponent(code)}`;
}

/** 个股详情深链 */
export function stockDetailUrl(code: string): string {
  return build('stockDetail', code);
}

/** 指数行情深链 */
export function indexUrl(code: string): string {
  return build('index', code);
}

/** 板块行情深链 */
export function boardUrl(code: string): string {
  return build('board', code);
}

/** 自选股列表深链 */
export function watchlistUrl(): string {
  return build('watchlist');
}

/** 人气热榜深链 */
export function hotlistUrl(): string {
  return build('hotlist');
}

/** 智能盯盘深链 */
export function monitorUrl(): string {
  return build('monitor');
}

/** 智能诊股深链 */
export function analyzeUrl(code: string): string {
  return build('analyze', code);
}

/** 按 Symbol 构建最合适的详情页深链 */
export function detailUrlForSymbol(symbol: Symbol): string {
  const page = resolveThsPage(symbol);
  return build(page, thsJumpCode(symbol));
}

/** 按 Symbol 构建诊股深链（仅个股有意义；指数/板块仍返回个股 analyze） */
export function analyzeUrlForSymbol(symbol: Symbol): string {
  return analyzeUrl(thsJumpCode(symbol));
}

/** 拉起任意 10jqka 深链；失败返回 false（未安装 / 系统拒绝） */
export async function openThsUrl(url: string): Promise<boolean> {
  try {
    // iOS 上 canOpenURL 对自定义 scheme 需 LSApplicationQueriesSchemes 白名单，
    // 这里直接 openURL：失败即视为未安装，避免额外权限配置。
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/** 打开标的详情页（自动识别个股/指数/板块） */
export function openThsDetail(symbol: Symbol): Promise<boolean> {
  return openThsUrl(detailUrlForSymbol(symbol));
}

/** 打开个股诊股页 */
export function openThsAnalyze(symbol: Symbol): Promise<boolean> {
  return openThsUrl(analyzeUrlForSymbol(symbol));
}

/** 打开自选股 / 热榜 / 盯盘 */
export function openThsWatchlist(): Promise<boolean> {
  return openThsUrl(watchlistUrl());
}
export function openThsHotlist(): Promise<boolean> {
  return openThsUrl(hotlistUrl());
}
export function openThsMonitor(): Promise<boolean> {
  return openThsUrl(monitorUrl());
}

/**
 * 跟单后跳转同花顺详情：先执行跟单动作，成功后拉起 App。
 * jumpOnFollow=false 时只跟单不跳转（默认跳转）。
 */
export async function followAndOpenThs<T extends { ok: boolean }>(
  follow: () => Promise<T>,
  symbol: Symbol,
  opts?: { jumpOnFollow?: boolean },
): Promise<T> {
  const result = await follow();
  if (result.ok && opts?.jumpOnFollow !== false) {
    await openThsDetail(symbol);
  }
  return result;
}

/** 平台信息（调试用） */
export function thsPlatformHint(): string {
  return Platform.OS;
}
