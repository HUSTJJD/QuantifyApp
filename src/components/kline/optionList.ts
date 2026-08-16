/**
 * 把本 App 的 Candle[] 适配为 native-kline-view 的 optionList 字符串。
 *
 * 该库 props.optionList 必须是 JSON.stringify 后的字符串，结构见库示例 App.js：
 *   { modelArray, shouldScrollToEnd, targetList, price, volume, primary, second, time, configList, drawList }
 */
import { Platform, PixelRatio, processColor } from 'react-native';
import type { Candle, KlinePeriod } from '@/api';
import { colors } from '@/theme';
import { calcMA, calcBOLL, calcMACD, calcKDJ, calcRSI, calcWR, sma, type RawCandle } from './indicators';

/** 主图指标 */
export type MainIndicator = 'none' | 'ma' | 'boll';
/** 副图指标 */
export type SubIndicator = 'none' | 'macd' | 'kdj' | 'rsi' | 'wr';

const TIME_MAP: Record<KlinePeriod, number> = {
  '1m': 1,
  '5m': 3,
  '15m': 4,
  '30m': 5,
  '60m': 6,
  day: 9,
  week: 10,
  month: 11,
};

const PRIMARY_MAP: Record<MainIndicator, number> = { none: 0, ma: 1, boll: 2 };
const SECOND_MAP: Record<SubIndicator, number> = { none: 0, macd: 3, kdj: 4, rsi: 5, wr: 6 };

export interface KLineOptionConfig {
  period: KlinePeriod;
  main?: MainIndicator;
  sub?: SubIndicator;
  /** 价格精度（小数位），A股通常 2 */
  pricePrecision?: number;
  /** 成交量精度 */
  volumePrecision?: number;
  isDark?: boolean;
}

function toRaw(c: Candle): RawCandle {
  return { open: c.open, high: c.high, low: c.low, close: c.close, vol: c.volume };
}

function toMs(datetime: number | string): number {
  return typeof datetime === 'number' ? datetime : new Date(datetime).getTime();
}

/**
 * processColor 在 Android 上对 'transparent' / 'rgba(...)' 等可能返回 null，
 * 而原生端 packModel 会对色值字段调用 .toString() 不设防。这里统一兜底为 0（黑色），
 * 避免 null 写入 optionList 后导致原生层 NullPointerException 闪退。
 */
function pc(value: string | number): number {
  const c = processColor(value);
  return typeof c === 'number' ? c : 0;
}

/** 安全数字兜底：NaN / null / undefined -> fallback */
function num(v: number, fallback = 0): number {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 原生 packModel 第 203 行直接对 keyValue.get("dateString").toString() 调用，
 * 若缺失该字段则 get 返回 null -> NPE 闪退。必须每个 model 都带 dateString（字符串日期）。
 */
function formatDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fixRound(v: number, precision: number): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  return Number(v).toFixed(precision);
}

/** 组装并返回 optionList 的 JSON 字符串 */
/**
 * 成交量均线（VOL MA）。原生 VolumeDraw 遍历 configManager.maVolumeList（来自 targetList.maVolumeList），
 * 并对每条数据 model 取同索引的 maVolumeList[i] 绘制。若数据侧缺失/不等长即 IndexOutOfBounds 崩溃。
 * 这里始终计算 MA5/MA10 成交量均线，且每条 model 的 maVolumeList 项都标 selected:true，
 * 与 targetList 的 maVolumeList 顺序 [5,10] 严格对应，避免原生层越界。
 */
function calcVOLMA(raw: RawCandle[], periods: number[]): Array<Array<{ value: number; title: string }>> {
  const volumes = raw.map((c) => c.vol);
  return raw.map((_, i) =>
    periods.map((p) => ({
      value: sma(volumes, p)[i] ?? 0,
      title: String(p),
    }))
  );
}

export function buildOptionList(candles: Candle[], cfg: KLineOptionConfig): string {
  const main = cfg.main ?? 'ma';
  const sub = cfg.sub ?? 'macd';
  const pricePrecision = cfg.pricePrecision ?? 2;
  const volumePrecision = cfg.volumePrecision ?? 0;
  const isDark = cfg.isDark ?? true;

  const raw = candles.map(toRaw);
  const maPeriods = [5, 10, 20];
  const rsiPeriods = [6, 12, 24];
  const wrPeriods = [14];
  // 成交量均线周期，须与下方 targetList.maVolumeList 的顺序 [5,10] 严格一致（原生 VolumeDraw 按索引对齐）
  const volMaPeriods = [5, 10];

  const maList = main === 'ma' ? calcMA(raw, maPeriods) : null;
  const boll = main === 'boll' ? calcBOLL(raw) : null;
  const macd = sub === 'macd' ? calcMACD(raw) : null;
  const kdj = sub === 'kdj' ? calcKDJ(raw) : null;
  const rsi = sub === 'rsi' ? calcRSI(raw, rsiPeriods) : null;
  const wr = sub === 'wr' ? calcWR(raw, wrPeriods) : null;
  // 成交量均线：原生 VolumeDraw 要求每条数据 model 的 maVolumeList 与 targetList.maVolumeList 等长且 selected:true
  const volMaList = calcVOLMA(raw, volMaPeriods);

  const modelArray = candles.map((c, i) => {
    const ts = toMs(c.datetime);
    const up = c.close >= c.open;
    const color = pc(up ? colors.up : colors.down);
    const appendValue = c.close - c.open;
    const appendPct = c.open !== 0 ? (appendValue / c.open) * 100 : 0;
    const sign = appendValue >= 0 ? '+' : '-';

    const item: Record<string, unknown> = {
      id: num(ts, 0),
      dateString: formatDate(ts),
      open: num(c.open),
      high: num(c.high),
      low: num(c.low),
      close: num(c.close),
      vol: num(c.volume),
    };

    if (maList) item.maList = maList[i];
    if (boll) Object.assign(item, boll[i]);
    if (macd) Object.assign(item, macd[i]);
    if (kdj) Object.assign(item, kdj[i]);
    if (rsi) item.rsiList = rsi[i];
    if (wr) item.wrList = wr[i];
    // 成交量均线：与 targetList.maVolumeList 顺序 [5,10] 对齐，每项 selected:true 才能被原生解析进 entity.maVolumeList。
    // 必须含 title 字段（原生 HTKLineTargetItem 构造第17行对 title 无 null 保护，缺失即 NPE）。
    item.maVolumeList = volMaList[i].map((m) => ({
      value: num(m.value),
      title: m.title,
      selected: true,
    }));

    const selectedItemList: Array<{ title: string; detail: string; color?: number }> = [
      { title: '时间', detail: formatTime(ts) },
      { title: '开', detail: fixRound(c.open, pricePrecision) },
      { title: '高', detail: fixRound(c.high, pricePrecision) },
      { title: '低', detail: fixRound(c.low, pricePrecision) },
      { title: '收', detail: fixRound(c.close, pricePrecision) },
      { title: '涨跌额', detail: `${sign}${fixRound(Math.abs(appendValue), pricePrecision)}`, color },
      { title: '涨跌幅', detail: `${sign}${fixRound(Math.abs(appendPct), 2)}%`, color },
      { title: '成交量', detail: fixRound(c.volume, volumePrecision) },
    ];
    if (maList) {
      maList[i].forEach((m) => selectedItemList.push({ title: `MA${m.title}`, detail: fixRound(m.value, pricePrecision) }));
    }
    if (boll) {
      selectedItemList.push(
        { title: 'BOLL上', detail: fixRound(boll[i].bollUp, pricePrecision) },
        { title: 'BOLL中', detail: fixRound(boll[i].bollMb, pricePrecision) },
        { title: 'BOLL下', detail: fixRound(boll[i].bollDn, pricePrecision) }
      );
    }
    if (macd) {
      selectedItemList.push(
        { title: 'DIF', detail: fixRound(macd[i].macdDif, 4) },
        { title: 'DEA', detail: fixRound(macd[i].macdDea, 4) },
        { title: 'MACD', detail: fixRound(macd[i].macdValue, 4) }
      );
    }
    if (kdj) {
      selectedItemList.push(
        { title: 'K', detail: fixRound(kdj[i].kdjK, 2) },
        { title: 'D', detail: fixRound(kdj[i].kdjD, 2) },
        { title: 'J', detail: fixRound(kdj[i].kdjJ, 2) }
      );
    }
    if (rsi) {
      rsi[i].forEach((r) => selectedItemList.push({ title: `RSI${r.title}`, detail: fixRound(r.value, 2) }));
    }
    if (wr) {
      wr[i].forEach((w) => selectedItemList.push({ title: `WR${w.title}`, detail: fixRound(w.value, 2) }));
    }
    item.selectedItemList = selectedItemList;

    return item;
  });

  const pixelRatio = Platform.select({ android: PixelRatio.get(), ios: 1 }) ?? 1;

  // 原生 reloadOptionList 对 configList 中大量字段直接 ((Number)get(...)).intValue()/.floatValue()
  // 或 (get(...)).toString()，无任何 null 保护。只要任一 key 缺失，get 返回 null -> NPE
  // （崩溃点之一为 HTKLineConfigManager.java:391 的 fontFamily）。必须把原生读取的全部字段补齐：
  // 颜色走 pc()、数值走 num()、字符串给 ''、列表给 []（parseColorList/parseLocationList 对 null 会 NPE）。
  const configList = {
    // —— 字符串类（必给非空字符串，否则 .toString() 崩）——
    fontFamily: '',
    closePriceRightLightLottieSource: '',
    closePriceRightLightLottieFloder: '',

    // —— 颜色类（pc: processColor 失败兜底 0）——
    colorList: {
      increaseColor: pc(colors.up),
      decreaseColor: pc(colors.down),
    },
    targetColorList: [
      pc('#F5DC95'),
      pc('#61D1C0'),
      pc('#CC92FF'),
      pc('#FF3B3D'),
      pc('#70D20A'),
      pc('#6F22FF'),
    ],
    minuteLineColor: pc(colors.primary),
    backgroundColor: pc(colors.background),
    textColor: pc(colors.textSecondary),
    gridColor: pc(colors.border),
    candleTextColor: pc(colors.text),
    panelBackgroundColor: pc(isDark ? 'rgba(14,17,22,0.92)' : 'rgba(255,255,255,0.95)'),
    panelBorderColor: pc(colors.textSecondary),
    panelTextColor: pc(colors.text),
    selectedPointContainerColor: pc('transparent'),
    selectedPointContentColor: pc(isDark ? colors.text : '#FFFFFF'),
    closePriceCenterSeparatorColor: pc(colors.border),
    closePriceCenterBorderColor: pc(colors.border),
    closePriceCenterBackgroundColor: pc(colors.background),
    closePriceCenterTriangleColor: pc(colors.textSecondary),
    closePriceRightSeparatorColor: pc(colors.border),
    closePriceRightBackgroundColor: pc(colors.background),
    minuteVolumeCandleColor: pc(colors.primary),

    // —— 数值类（num: NaN/null 兜底 0）——
    mainFlex: sub === 'none' ? 0.85 : 0.6,
    volumeFlex: 0.15,
    paddingTop: num(20 * pixelRatio),
    paddingBottom: num(20 * pixelRatio),
    paddingRight: num(50 * pixelRatio),
    itemWidth: num(8 * pixelRatio),
    candleWidth: num(6 * pixelRatio),
    macdCandleWidth: num(1 * pixelRatio),
    headerTextFontSize: num(10 * pixelRatio),
    rightTextFontSize: num(10 * pixelRatio),
    candleTextFontSize: num(10 * pixelRatio),
    panelTextFontSize: num(10 * pixelRatio),
    panelMinWidth: num(130 * pixelRatio),
    closePriceRightLightLottieScale: num(1),
    // 分钟成交量蜡烛：原生 reloadOptionList:419/418 读取，缺失即 NPE（minuteVolumeCandleColor 已在上方定义）
    minuteVolumeCandleWidth: num(1 * pixelRatio),

    // —— 列表类（给 [] 空数组，原生 parseColorList/parseLocationList 对 null 会 NPE）——
    panelGradientColorList: [],
    panelGradientLocationList: [],
    minuteGradientColorList: [],
    minuteGradientLocationList: [],
  };

  const targetList = {
    maList: [
      { title: '5', selected: main === 'ma', index: 0 },
      { title: '10', selected: main === 'ma', index: 1 },
      { title: '20', selected: main === 'ma', index: 2 },
    ],
    maVolumeList: [
      { title: '5', selected: true, index: 0 },
      { title: '10', selected: true, index: 1 },
    ],
    bollN: '20',
    bollP: '2',
    macdS: '12',
    macdL: '26',
    macdM: '9',
    kdjN: '9',
    kdjM1: '3',
    kdjM2: '3',
    rsiList: [
      { title: '6', selected: sub === 'rsi', index: 0 },
      { title: '12', selected: sub === 'rsi', index: 1 },
      { title: '24', selected: sub === 'rsi', index: 2 },
    ],
    wrList: [{ title: '14', selected: sub === 'wr', index: 0 }],
  };

  const drawList = {
    shotBackgroundColor: pc(colors.background),
    drawType: 0,
    shouldReloadDrawItemIndex: -3,
    drawShouldContinue: true,
    drawColor: pc(colors.primary),
    drawLineHeight: 2,
    drawDashWidth: 4,
    drawDashSpace: 4,
    drawIsLock: false,
    shouldFixDraw: false,
    shouldClearDraw: false,
  };

  const optionList = {
    modelArray,
    shouldScrollToEnd: true,
    targetList,
    price: pricePrecision,
    volume: volumePrecision,
    primary: PRIMARY_MAP[main],
    second: SECOND_MAP[sub],
    time: TIME_MAP[cfg.period],
    configList,
    drawList,
  };

  // 原生端 packModel 会对字段直接 .toString()，遇到 null/NaN 即 NPE 闪退。
  // 这里递归兜底：数字 NaN/null -> 0，字符串 null -> ''，对象/数组递归处理。
  return JSON.stringify(sanitize(optionList));
}

/** 递归清洗：消除所有 null / undefined / NaN，防止原生层 NPE 闪退 */
function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = sanitize(v);
    return out;
  }
  return 0;
}
