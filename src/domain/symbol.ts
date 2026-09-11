/**
 * 标的标识领域工具：代码↔统一 Symbol 互转、市场归类。
 * 集中处理交易所后缀，避免散落在各数据源里。
 */
import type { Exchange, Market, Symbol } from '@/data/api';

const EXCHANGE_SUFFIX: Record<Exchange, string> = {
  SH: '.SH',
  SZ: '.SZ',
  BJ: '.BJ',
  HK: '.HK',
  TI: '.TI',
  OF: '.OF',
  US: '.US',
  // 东方财富板块（BKxxxx），无官方 thscode 后缀；仅内部路由用
  EM: '.EM',
};

/**
 * 同花顺官方服务（hithink-finance skill）接受的 thscode 后缀白名单。
 * 参考 references/api/capability-map.md：
 *   thscode 必须带交易所后缀（.SH / .SZ / .BJ / .TI），纯 6 位代码不被接受。
 * 注意：港股(.HK)/美股不在官方覆盖范围内（skill 能力边界“超出范围”），
 * 其 thscode 不应进入同花顺官方源，否则服务端判“标的代码不支持”。
 */
const THS_SUPPORTED_SUFFIX: ReadonlySet<Exchange> = new Set<Exchange>(['SH', 'SZ', 'BJ', 'TI', 'OF']);

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

/** 把 600519.SH / 00700.HK 这样的完整代码解析成 Symbol */
export function parseSymbol(fullCode: string): Symbol {
  const cleaned = normalizeSymbolCode(fullCode);
  const m = cleaned.match(/^(\d+)\.([A-Z]{2})$/);
  if (m) {
    return { code: m[1], exchange: SUFFIX_TO_EXCHANGE[m[2]] ?? 'SH' };
  }
  // 没有后缀则按规则推断
  return inferSymbol(cleaned);
}

/**
 * 归一化脏代码：去掉 sh/sz/bj/hk/us 等市场前缀、大小写不敏感后缀。
 * 例：sh603986 → 603986；SH603986 → 603986；hk03986 → 03986；
 *     603986.sh → 603986.SH；sh603986.SH → 603986
 */
export function normalizeSymbolCode(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) return s;
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

/**
 * 清洗 Symbol：code 里混入 sh/hk 等前缀或重复后缀时，
 * 前缀优先决定交易所（hk03986 + exchange=SH 会纠为 03986.HK）。
 */
export function sanitizeSymbol(input: Symbol): Symbol {
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
export function isFundSymbol(symbol: Symbol): boolean {
  return symbol.exchange === 'OF';
}

/**
 * 期权合约代码：如 AO2610P3150 / 10007510（含字母行权价后缀）。
 * 与 6 位纯数字股票代码区分。
 */
export function isOptionCode(code: string): boolean {
  const c = String(code ?? '').trim();
  if (!c) return false;
  // 沪深期权：AO/CU 等品种 + 到期 + C/P + 行权价；或纯数字 8 位期权
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
  // 沪市国债/企债/转债：10/11/12 开头（6~10 位），如 113050、10011450
  if (/^1[012]\d{4,8}$/.test(c)) return true;
  // 深市转债：123/127/128 等 6 位
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
export function isNonKlineSymbol(symbol: Symbol): boolean {
  return (
    isFundSymbol(symbol) ||
    isOptionCode(symbol.code) ||
    isBondCode(symbol.code) ||
    isListedFundCode(symbol.code)
  );
}

/** 根据代码特征推断交易所 */
export function inferSymbol(code: string): Symbol {
  if (/^\d{5}$/.test(code)) return { code, exchange: 'HK' };
  if (code.startsWith('6')) return { code, exchange: 'SH' };
  if (code.startsWith('0') || code.startsWith('3')) return { code, exchange: 'SZ' };
  if (code.startsWith('8') || code.startsWith('4')) return { code, exchange: 'BJ' };
  return { code, exchange: 'SH' };
}

/** Symbol -> 完整代码字符串 */
export function toFullCode(symbol: Symbol): string {
  return `${symbol.code}${EXCHANGE_SUFFIX[symbol.exchange] ?? ''}`;
}

/** Symbol -> 展示文本，例如 600519.SH 贵州茅台 */
export function displaySymbol(symbol: Symbol, name?: string): string {
  const code = toFullCode(symbol);
  return name ? `${name}(${code})` : code;
}

/** 交易所 -> 市场大类 */
export function marketOf(exchange: Exchange): Market {
  if (exchange === 'HK') return 'HK';
  if (exchange === 'US') return 'US';
  return 'A';
}

/**
 * 本项目 Symbol -> 同花顺 thscode（如 600519.SH / 886042.TI / 025480.OF）。
 *
 * 严格遵循 skill 契约：thscode 必须带交易所后缀（.SH/.SZ/.BJ/.TI/.OF），
 * 纯 6 位代码不被接受；且港股(.HK)/美股等超出官方覆盖范围。
 *
 * 规范化规则：
 *  1. 若 code 已带合法后缀（如 600519.SH），不再重复拼接，避免 600519.SH.SH；
 *  2. 若 exchange 后缀不在官方白名单（如 HK），抛错，避免构造出契约外的 .HK
 *     被官方源判为“标的代码不支持”（港股应走第三方兜底源）。
 */
export function toThsCode(symbol: Symbol): string {
  const { code, exchange } = symbol;
  // 东财板块无同花顺 thscode
  if (exchange === 'EM' || isEmBoardCode(code)) {
    throw new Error(
      `toThsCode: 东方财富板块 ${code} 无同花顺 thscode，应走 stock-sdk board.*`,
    );
  }
  // 1) 已带后缀：如 600519.SH / 00700.HK —— 直接使用，去掉多余后缀拼接
  const m = code.match(/^([^.]+)\.([A-Z]{2})$/);
  if (m) {
    const ex = m[2] as Exchange;
    if (!THS_SUPPORTED_SUFFIX.has(ex)) {
      throw new Error(
        `toThsCode: 标的 ${code} 的后缀 .${ex} 不在同花顺官方支持范围（.SH/.SZ/.BJ/.TI/.OF），` +
          `港股/美股等应走第三方兜底源`,
      );
    }
    return code;
  }
  // 2) 纯代码：按 exchange 拼接官方后缀
  if (!THS_SUPPORTED_SUFFIX.has(exchange)) {
    throw new Error(
      `toThsCode: 交易所 ${exchange} 不在同花顺官方支持范围（.SH/.SZ/.BJ/.TI/.OF），` +
        `标的 ${code} 应走第三方兜底源`,
    );
  }
  return `${code}${EXCHANGE_SUFFIX[exchange]}`;
}

/**
 * 判断是否为「指数 / 板块」类标的（区别于个股）。
 *
 * 行情源对个股与指数/板块使用不同的端点与代码体系（如 hithsa：
 * /api/a-share/prices/* vs /api/a-share-index/prices/*），行情封装（MarketDataClient）
 * 按此分流：个股 → getQuotes/getKline，指数/板块 → getIndexQuotes/getIndexKline。
 * 判别规则（与代码段约定一致）：
 *  - exchange 'TI'：同花顺概念/行业等板块指数（如 886042.TI），恒为指数；
 *  - exchange 'EM'：东方财富行业/概念板块（BK1027 等），走 stock-sdk board.*；
 *  - SH：仅 000 开头且排除 A 股常见 000xxx 个股段之外——上证指数系列
 *    （000001 上证指数、000300 沪深300）。注意 0005xx/0006xx/0007xx/0008xx/0009xx
 *    多为深市个股被误标 SH 时的兜底；本函数要求「SH + 000 且 6 位纯数字」
 *    才视为指数（000001 既是上证指数也是平安银行 SZ，靠 exchange 区分）；
 *  - SZ 且 399 开头：深证系列指数（399001 深证成指等）；
 *  - BJ 且 899 开头：北证 50（899050.BJ）等北交所指数。
 */
export function isIndexSymbol(symbol: Symbol): boolean {
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
export function boardSymbol(code: string, name?: string): Symbol {
  const c = String(code ?? '').trim();
  if (isEmBoardCode(c)) {
    return { code: c.toUpperCase(), exchange: 'EM', name };
  }
  return { code: c, exchange: 'TI', name };
}

/** 同花顺 thscode -> 本项目 Symbol */
export function fromThsCode(thsCode: string): Symbol {
  return parseSymbol(thsCode);
}
