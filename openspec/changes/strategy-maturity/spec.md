# change: strategy-maturity — 策略引擎成熟化（第一优先）

## Why

当前策略只有「模板 + 开关 + 少量参数」，信号可解释性弱、风控不闭环、无法支撑真实决策。
把策略层做扎实，后面的回测 / 模拟盘 / 跟单才有意义。

## What Changes

### 1. 策略模板库扩充

| 模板 | 信号 | 默认参数 |
|---|---|---|
| MA 金叉死叉 | 快线上穿/下穿慢线 | fast=5, slow=20 |
| MACD 金叉 | DIF 上穿 DEA | 12/26/9 |
| RSI 超卖反弹 | RSI 从 <30 回升 | period=14, buy=30, sell=70 |
| 放量突破 | 价创 N 日新高且量 ≥ k 倍均量 | days=20, volRatio=2 |
| 均线多头排列 | MA5>MA10>MA20 | 5/10/20 |
| 布林下轨 | 收盘触及下轨 | period=20, k=2 |

每个模板：`id / label / defaultParams / evaluate(candles, ctx) => PartialSignal`

### 2. 信号合并升级

- 每策略有权重 `weight`（默认 1）
- 强度加权求和后 clamp 到 [-3, 3]
- 阈值：≥1 买，≤-1 卖，否则 hold
- 输出 `contributions[]` 供 UI 展示

### 3. 风控规则引擎

```ts
checkRisk({ position, quote, rules }) → { action: 'hold'|'take_profit'|'stop_loss'|'trailing_stop' }
```

- 止盈：相对成本价上涨 ≥ takeProfitPct
- 止损：相对成本价下跌 ≥ stopLossPct
- 移动止损：从最高价回撤 ≥ trailingPct

### 4. 交易时段门控

- `session: early|intraday|late|any`
- 自动下单前校验当前是否在允许时段

## Impact

- Affected: `quant/profile.ts` `quant/strategies.ts` `quant/signals.ts` `quant/SignalEngine.ts` `quant/StrategyEngine.ts`
- Tests: 策略单元测试、信号合并测试、风控测试
- UI: 策略编辑页增加参数滑杆与权重

## Acceptance

1. 六个模板均可开关并调参
2. 双策略加权后 strength 符合预期
3. 止盈/止损/移动止损在模拟盘可触发
4. 非交易时段 autoTrade 不下单
