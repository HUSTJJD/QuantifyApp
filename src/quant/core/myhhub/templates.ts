/**
 * InStock（myhhub/stock）策略模板：基于移植因子组合。
 * 原项目：https://github.com/myhhub/stock （instock/core/strategy）
 *
 * 框架约定：每个模板需同时含 buy 与 sell 规则（见 __tests__/strategiesFramework.test.ts）。
 */
import type { StrategyTemplate } from '../types';

/** 海龟突破 */
export const turtleBreakoutTemplate: StrategyTemplate = {
  id: 'myh_turtle_breakout',
  label: '海龟突破',
  description: '参考 InStock：收盘创 60 日新高右侧追涨；跌破区间新离场。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '海龟突破：60日新高',
      conditions: [{ kind: 'triggered', factorId: 'myh_turtle', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '海龟离场：跌破 20 日新低或均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'sell', params: { days: 20 } },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};

/** 均线多头趋势 */
export const maBullTemplate: StrategyTemplate = {
  id: 'myh_ma_bull',
  label: '均线多头',
  description: '参考 InStock：MA30 逐级抬升且 30 日涨幅超过 20%；多头破坏则卖出。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '均线多头（MA30 持续上行）',
      conditions: [{ kind: 'triggered', factorId: 'myh_keep_increasing', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '趋势破坏：均线空头或 MACD 死叉',
      conditions: [
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
        { kind: 'triggered', factorId: 'macd', side: 'sell' },
      ],
    },
  ],
};

/** 平台突破 + 放量 */
export const platformBreakTemplate: StrategyTemplate = {
  id: 'myh_platform_break',
  label: '平台突破',
  description: '参考 InStock：放量上穿 MA60，且此前价格贴合均线；跌破平台离场。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 3,
      reason: '平台突破（MA60 放量）',
      conditions: [
        { kind: 'triggered', factorId: 'myh_platform_breakout', side: 'buy' },
        { kind: 'score', factorId: 'ma_trend', op: 'gte', value: 0 },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '跌破均线或放量下跌',
      conditions: [
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.3 },
        { kind: 'triggered', factorId: 'myh_climax_limitdown', side: 'sell' },
      ],
    },
  ],
};

/** 回踩年线 */
export const backtraceYearMaTemplate: StrategyTemplate = {
  id: 'myh_backtrace_year',
  label: '回踩年线',
  description: '参考 InStock：突破年线后缩量回踩不破；跌破年线离场。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '回踩年线缩量',
      conditions: [{ kind: 'triggered', factorId: 'myh_backtrace_ma250', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '年线失守或均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'sell', params: { days: 60 } },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};

/** 放量上涨短线 */
export const volumeSurgeTemplate: StrategyTemplate = {
  id: 'myh_volume_surge',
  label: '放量上涨',
  description: '参考 InStock：涨幅≥2%、收盘>开盘、成交额≥2亿、量比≥2；冲高回落或放量跌停离场。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '放量上涨',
      conditions: [{ kind: 'triggered', factorId: 'myh_volume_surge', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 3,
      reason: '放量跌停或均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'myh_climax_limitdown', side: 'sell' },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};

/** 风险：放量跌停 —— 仍补一条弱买侧空规则避免框架单侧（仅在明确反包时） */
export const climaxLimitDownTemplate: StrategyTemplate = {
  id: 'myh_climax_limitdown',
  label: '放量跌停警戒',
  description: '参考 InStock：大跌+巨量作卖出/回避；超卖反弹（RSI）可作极短线反抽参考。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 1,
      reason: '超卖反抽（配合跌停后观察，谨慎）',
      conditions: [
        { kind: 'score', factorId: 'rsi', op: 'lt', value: 0.2 },
        { kind: 'score', factorId: 'ma_trend', op: 'gte', value: -0.5 },
      ],
    },
    {
      mode: 'and',
      side: 'sell',
      strength: 3,
      reason: '放量跌停，注意风险',
      conditions: [{ kind: 'triggered', factorId: 'myh_climax_limitdown', side: 'sell' }],
    },
  ],
};

/** 低波动成长 */
export const lowAtrGrowthTemplate: StrategyTemplate = {
  id: 'myh_low_atr_growth',
  label: '低波动成长',
  description: '参考 InStock：近期日均涨跌不大，但区间高低抬升；趋势破坏卖出。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 1,
      reason: '低波动成长',
      conditions: [
        { kind: 'triggered', factorId: 'myh_low_atr', side: 'buy' },
        { kind: 'score', factorId: 'ma_trend', op: 'gte', value: 0 },
      ],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '均线空头或跌破新低',
      conditions: [
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
        { kind: 'triggered', factorId: 'breakout', side: 'sell' },
      ],
    },
  ],
};

/** 高窄旗形 */
export const highTightFlagTemplate: StrategyTemplate = {
  id: 'myh_high_tight_flag',
  label: '高窄旗形',
  description: '参考 InStock：短期快速拉升后窄幅整理；旗形破坏离场。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '高而窄旗形',
      conditions: [{ kind: 'triggered', factorId: 'myh_high_tight_flag', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '旗形破坏：跌破新低或均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'sell' },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};

/** 停机坪 */
export const parkingApronTemplate: StrategyTemplate = {
  id: 'myh_parking_apron',
  label: '停机坪',
  description: '参考 InStock：涨停放量后高开平台整理 3 日，不破涨停收盘价。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '停机坪整理完成',
      conditions: [{ kind: 'triggered', factorId: 'myh_parking_apron', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '平台跌破或放量跌停',
      conditions: [
        { kind: 'triggered', factorId: 'breakout', side: 'sell', params: { days: 15 } },
        { kind: 'triggered', factorId: 'myh_climax_limitdown', side: 'sell' },
      ],
    },
  ],
};

/** 无大幅回撤上涨 */
export const noDeepPullbackTemplate: StrategyTemplate = {
  id: 'myh_no_deep_pullback',
  label: '稳健上涨',
  description: '参考 InStock：60 日上涨超 60% 且无单日/两日深回撤。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '稳健上涨无深回撤',
      conditions: [{ kind: 'triggered', factorId: 'myh_low_backtrace', side: 'buy' }],
    },
    {
      mode: 'or',
      side: 'sell',
      strength: 2,
      reason: '出现深回撤或均线空头',
      conditions: [
        { kind: 'triggered', factorId: 'myh_climax_limitdown', side: 'sell' },
        { kind: 'score', factorId: 'ma_trend', op: 'lt', value: -0.5 },
      ],
    },
  ],
};

/** K 线形态信号 */
export const candlePatternTemplate: StrategyTemplate = {
  id: 'myh_candle_pattern',
  label: 'K线形态',
  description: '对照 InStock 形态识别：晨星/吞没/锤头等净信号触发买卖。',
  rules: [
    {
      mode: 'and',
      side: 'buy',
      strength: 2,
      reason: '看涨 K 线形态',
      conditions: [{ kind: 'triggered', factorId: 'myh_candle_pattern', side: 'buy' }],
    },
    {
      mode: 'and',
      side: 'sell',
      strength: 2,
      reason: '看跌 K 线形态',
      conditions: [{ kind: 'triggered', factorId: 'myh_candle_pattern', side: 'sell' }],
    },
  ],
};

export const MYHHUB_TEMPLATES: StrategyTemplate[] = [
  turtleBreakoutTemplate,
  maBullTemplate,
  platformBreakTemplate,
  backtraceYearMaTemplate,
  volumeSurgeTemplate,
  climaxLimitDownTemplate,
  lowAtrGrowthTemplate,
  highTightFlagTemplate,
  parkingApronTemplate,
  noDeepPullbackTemplate,
  candlePatternTemplate,
];
