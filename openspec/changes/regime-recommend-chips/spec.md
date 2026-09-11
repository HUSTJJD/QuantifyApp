# change: regime-recommend-chips — 市况 regime 推荐策略 chips（下一阶段第三优先）

> **状态：已交付（2026-09-12）**。。对标 Opptrix `discoverProfiles` + `ETF_REGIME_STRATEGY_IDS`：按市场情绪推荐策略模板。

## Why

策略 Tab 已有「今日脉冲」，但用户仍不知道「现在市况适合哪类策略」。Opptrix 按 panic/cautious/neutral/euphoria 路由推荐；本 App 可用涨跌家数/涨停跌停/量能做本地 regime。

## What Changes

### 1. Regime 判定（纯函数）

输入：涨跌家数、涨跌停数、大盘涨跌幅、量能相对均量。

```ts
type Regime = 'panic' | 'cautious' | 'neutral' | 'euphoria';
detectRegime(input): { regime: Regime; reason: string };
```

| 档 | 启发式（可调） |
|----|----------------|
| panic | 跌幅家数 >70% 且跌停 > 涨停 ×2 |
| euphoria | 涨幅家数 >70% 且涨停 > 跌停 ×2 |
| cautious | 大盘 \|pct\| >1.5% 但未达 panic/euphoria |
| neutral | 其余 |

数据：`getAnomalyList` / 涨跌停池 / IndexBar 已有 quote，尽量本地已有。

### 2. 推荐映射

```ts
REGIME_PRESETS: Record<Regime, { templateIds: string[]; note: string }>
// panic: 均线/低波防守模板 + note「控制仓位，等待企稳」
// euphoria: 动量/突破模板 + note「注意追高风险」
// …
```

### 3. UI

策略 Tab 脉冲卡下增加一行 chips：

```
市况 中性 · 均线多头 | MACD 金叉
「控制仓位…」
```

点击 chip → `StrategyEdit` 预选模板。

### 4. 每日缓存

regime 结果写入 `appPrefs` 或 KV，当日不重复算；手动下拉刷新。

## Impact

- Affected: 新 `src/quant/regime.ts` `StrategiesScreen` `strategyTemplates` 预填
- Risks: 启发式误判 — 必须展示 reason，文案避免「必涨」；不自动下单

## Acceptance

1. 策略 Tab 显示市况档 + 原因 + 推荐模板 chips
2. 点击 chip 进入新建策略并预选模板
3. 无行情数据时显示「市况未知」
