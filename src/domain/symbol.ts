/**
 * 标的标识领域模块：App 规范符号对象 + 唯一字符串键 + 市场归类。
 *
 * 规范键（唯一）：`CODE.EXCHANGE`，如 `600519.SH` / `00700.HK`。
 * 禁止 `EXCHANGE.CODE` 反序键；各数据源线格式由 src/data/api/sources/codecs/* 负责。
 */
import type { Exchange, Market } from '@/data/api/types';

/** App 规范标的对象（data/api 以 `Symbol` 名 re-export） */
export interface AppSymbol {
  code: string;
  exchange: Exchange;
  name?: string;
}

/** 交易所后缀表（展示 / 推断用；规范键直接 `${code}.${exchange}`） */
const SUFFIX_TO_EXCHANGE: Record<string, Exchange> = {
  SH: 'SH',
  SZ: 'SZ',
  BJ: 'BJ',
  HK: 'HK',
  TI: 'TI',
  OF: 'OF',
  US: 'US',
  EM: 'EM',
};

/**
 * 唯一规范字符串键：`CODE.EXCHANGE`。
 * 所有缓存 / DB / 信号 / 路由分区键必须使用本函数，禁止手拼或反序键。
 */
export function symbolKey(symbol: AppSymbol): string {
  return `${symbol.code}.${symbol.exchange}`;
}

/** 规范键 → AppSymbol；脏输入（sh600519 / SH.600519）经 normalize/sanitize 纠偏 */
export function parseSymbolKey(key: string): AppSymbol {
  return parseSymbol(normalizeSymbolCode(key));
}

/**
 * 归一化脏代码：去掉 sh/sz/bj/hk/us 等市场前缀、大小写不敏感后缀。
 * 例：sh603986 → 603986；SH603986 → 603986；hk03986 → 03986；
 *     603986.sh → 603986.SH；sh603986.SH → 603986
 *     SH.600519（反序历史键）→ 600519.SH
 */
export function normalizeSymbolCode(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return s;
  // 反序历史键 EXCHANGE.CODE → CODE.EXCHANGE
  const rev = s.match(/^(SH|SZ|BJ|HK|TI|OF|US|EM)\.([A-Za-z0-9]+)$/i);
  if (rev) {
    return `${rev[2]}.${rev[1]!.toUpperCase()}`;
  }
  // 1) 去掉 sh./sz./bj./hk./us./jj. 这种「前缀+点」（jj=基金）
  s = s.replace(/^(sh|sz|bj|hk|us|jj)\./i, '');
  // 2) 去掉紧贴数字/字母的市场前缀（sh603986 / HK03986 / jj007000）
  s = s.replace(/^(sh|sz|bj|hk|us|jj)(?=\d)/i, '');
  // 3) 后缀规范为大写
  const m = s.match(/^([^.]+)\.([a-z]{2})$/i);
  if (m) {
    return `${m[1]}.${m[2]!.toUpperCase()}`;
  }
  return s;
}

/** 内部：已 normalize 的 CODE.EXCHANGE / 裸码 → AppSymbol */
function parseSymbol(fullCode: string): AppSymbol {
  const cleaned = fullCode;
  const m = cleaned.match(/^([A-Za-z0-9]+)\.([A-Z]{2})$/);
  if (m) {
    return { code: m[1]!, exchange: SUFFIX_TO_EXCHANGE[m[2]!] ?? 'SH' };
  }
  return inferSymbol(cleaned);
}

/**
 * 清洗 Symbol：code 里混入 sh/hk 等前缀或重复后缀时，
 * 前缀优先决定交易所（hk03986 + exchange=SH 会纠为 03986.HK）。
 */
export function sanitizeSymbol(input: AppSymbol): AppSymbol {
  const raw = String(input.code ?? '').trim();
  if (!raw) return input;

  let code = raw;
  let exchange = input.exchange;
  let forced: Exchange | null = null;

  // jj 前缀 = 场外/场内基金标记，清洗后按 OF 处理
  let isFund = false;
  if (/^jj(?=\d)/i.test(code)) {
    isFund = true;
    code = code.replace(/^jj/i, '');
  }

  const pref = code.match(/^(sh|sz|bj|hk|us)(?=\d)/i);
  if (pref) {
    const p = pref[1]!.toLowerCase();
    code = code.slice(pref[0].length);
    forced =
      p === 'sh'
        ? 'SH'
        : p === 'sz'
          ? 'SZ'
          : p === 'bj'
            ? 'BJ'
            : p === 'hk'
              ? 'HK'
              : 'US';
  }

  const suf = code.match(/^([^.]+)\.([A-Za-z]{2})$/);
  if (suf) {
    code = suf[1]!;
    if (!forced) {
      forced = SUFFIX_TO_EXCHANGE[suf[2]!.toUpperCase()] ?? null;
    }
  }

  if (isFund && !forced) forced = 'OF';
  // 保留 name 等业务字段（仅纠正 code/exchange）
  return { ...input, code, exchange: forced ?? exchange };
}

/** 场内基金（OF）——无个股 K 线/复权语义，走净值/基金行情 */
export function isFundSymbol(symbol: AppSymbol): boolean {
  return symbol.exchange === 'OF';
}

/**
 * 期权合约代码：如 AO2610P3150 / 10007510（含字母行权价后缀）。
 * 与 6 位纯数字股票代码区分。
 */
export function isOptionCode(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!c) return false;
  if (/^[A-Z]{1,3}\d{4}[CP]\d+$/i.test(c)) return true;
  if (/^[A-Z]{2,}\d+[CP]\d+$/i.test(c)) return true;
  return false;
}

/**
 * 债券 / 可转债代码（沪 10/11/12 开头，深 12 开头等）。
 * 例：10011450.SH、113050.SH、127xxx.SZ —— 无个股 K 线/复权契约。
 */
export function isBondCode(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!/^\d+$/.test(c)) return false;
  if (/^1[012]\d{4,8}$/.test(c)) return true;
  if (/^12[3-9]\d{3}$/.test(c)) return true;
  return false;
}

/**
 * 场内基金 / ETF / LOF 代码（非 OF 交易所、而是挂 SH/SZ）。
 *  - 沪：5xxxxx（51x ETF、50x LOF、56x/58x ETF）
 *  - 深：15xxxx / 16xxxx / 18xxxx
 */
export function isListedFundCode(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!/^\d+$/.test(c)) return false;
  if (/^5\d{5}$/.test(c)) return true;
  if (/^(15|16|18)\d{4}$/.test(c)) return true;
  return false;
}

/** 个股/指数外的「无 K 线契约」标的：场内基金、ETF/LOF、期权、债券 */
export function isNonKlineSymbol(symbol: AppSymbol): boolean {
  return (
    isFundSymbol(symbol) ||
    isOptionCode(symbol.code) ||
    isBondCode(symbol.code) ||
    isListedFundCode(symbol.code)
  );
}

/** 根据代码特征推断交易所 */
export function inferSymbol(code: string): AppSymbol {
  if (/^\d{5}$/.test(code)) return { code, exchange: 'HK' };
  if (code.startsWith('6')) return { code, exchange: 'SH' };
  if (code.startsWith('0') || code.startsWith('3')) return { code, exchange: 'SZ' };
  if (code.startsWith('8') || code.startsWith('4')) return { code, exchange: 'BJ' };
  return { code, exchange: 'SH' };
}

/** Symbol -> 展示文本，例如 600519.SH 贵州茅台 */
export function displaySymbol(symbol: AppSymbol, name?: string): string {
  const code = symbolKey(symbol);
  return name ? `${name}(${code})` : code;
}

/** 交易所 -> 市场大类 */
export function marketOf(exchange: Exchange): Market {
  if (exchange === 'HK') return 'HK';
  if (exchange === 'US') return 'US';
  return 'A';
}

/**
 * 判断是否为「指数 / 板块」类标的（区别于个股）。
 *
 * 行情源对个股与指数/板块使用不同的端点与代码体系（如 hithsa：
 * /api/a-share/prices/* vs /api/a-share-index/prices/*），行情封装（MarketDataClient）
 * 按此分流：个股 → getQuotes/getKline，指数/板块 → getIndexQuotes/getIndexKline。
 */
export function isIndexSymbol(symbol: AppSymbol): boolean {
  if (symbol.exchange === 'TI' || symbol.exchange === 'EM') return true;
  // 上证指数：000xxx.SH（个股平安银行是 000001.SZ，exchange 不同）
  if (symbol.exchange === 'SH') return /^000\d{3}$/.test(symbol.code);
  if (symbol.exchange === 'SZ') return /^399\d{3}$/.test(symbol.code);
  if (symbol.exchange === 'BJ') return /^899\d{3}$/.test(symbol.code);
  return false;
}

/** 东方财富板块码：BK + 数字（如 BK1027） */
export function isEmBoardCode(code: string): boolean {
  return /^BK\d+$/i.test(String(code ?? '').trim());
}

/** 同花顺板块指数：88 开头六位（如 886042），或已带 .TI */
export function isThsBoardCode(code: string): boolean {
  return /^88\d{4}$/.test(String(code ?? '').replace(/\.[A-Z]{2}$/i, ''));
}

/**
 * 把 listIndices / 资金流等来源的板块 code 归一成 Symbol。
 * - BKxxxx → EM（东财板块，stock-sdk board.*）
 * - 88xxxx → TI（同花顺板块指数）
 */
export function boardSymbol(code: string, name?: string): AppSymbol {
  const c = String(code ?? '').trim();
  if (isEmBoardCode(c)) {
    return { code: c.toUpperCase(), exchange: 'EM', name };
  }
  return { code: c, exchange: 'TI', name };
}
