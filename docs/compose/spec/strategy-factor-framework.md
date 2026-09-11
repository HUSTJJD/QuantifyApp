---
feature: strategy-factor-framework
status: delivered
updated: 2026-09-11
branch: feat/strategy-factor-framework
commits: ad13601..b94ba20
---

# 多因子策略框架 + 目录分层重组

## Report

**What was built** — `src/strategies/` 多因子框架：7 个可调参因子、规则 DSL（score/triggered/cross × AND/OR）、评估引擎、3 个精选模板（默认 trend_confirm）。数据层物理迁至 `src/data/`，旧路径 re-export 垫片保兼容。

**Verification** — tsc PASS；yarn test PASS 511 passed / 5 skipped / 47 suites（含 strategiesFramework.test 12 用例）。

**Journey log** — 1) moduleNameMapper 对 `@/db` 别名解析不稳，物理目录 + re-export 垫片更可靠；2) jest.setup 用相对路径 require 更稳；3) 测试期望需与「3 模板 / 默认 1 个」对齐。

## [S1] Problem

现有策略层是「单指标硬编码 + 简单加权合并」，用户无法灵活组合因子、调参困难。策略代码散落在 `src/quant/` 与业务引擎混杂。App 目录缺少清晰分层，数据/策略/UI 边界模糊。

需要：
1. **多因子框架**：因子可注册、可调参，策略=因子规则组合（DSL）
2. **策略独立文件夹**：`src/strategies/`
3. **2–3 个精选内置模板**，而非大量单指标策略
4. **全量目录分层重组**

## [S2] Design

### S2.1 因子（Factor）

因子是纯函数，从 K 线算出可解释的量化信号。

```ts
// src/strategies/types.ts
export interface FactorParamDef {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

export interface FactorResult {
  /** 归一化分数 [-1,1]：>0 偏多、<0 偏空、0 中性 */
  score: number;
  /** 可读原因，如「MA5 上穿 MA20」 */
  reason: string;
  /** 事件型因子是否刚触发（交叉/突破等） */
  triggered?: boolean;
}

export interface FactorDef {
  id: string;
  label: string;
  group: 'trend' | 'momentum' | 'volume' | 'volatility';
  params: FactorParamDef[];
  evaluate: (candles: Candle[], params: Record<string, number>) => FactorResult | null;
}
```

**注册表**（`src/strategies/factors/index.ts`）：

| id | 说明 | 关键参数 |
|---|---|---|
| `ma_cross` | MA 快慢线交叉 | fast=5, slow=20 |
| `macd` | MACD 金叉/死叉 + 柱体 | fast=12, slow=26, signal=9 |
| `rsi` | RSI 超买/超卖 | period=14, buy=30, sell=70 |
| `volume_ratio` | 量比（当日/均量） | maPeriod=5, threshold=1.5 |
| `breakout` | N 日新高/新低突破 | days=20 |
| `bollinger` | 布林带位置/突破 | period=20, k=2 |
| `ma_trend` | 均线多头/空头排列 | p1=5, p2=10, p3=20 |

新增因子 = 在注册表加一个 `FactorDef`，无需改引擎。

### S2.2 策略规则 DSL

```ts
export type FactorCondition =
  | { kind: 'score'; factorId: string; params?: Record<string, number>; op: 'gt'|'lt'|'gte'|'lte'; value: number }
  | { kind: 'triggered'; factorId: string; params?: Record<string, number>; side: 'buy' | 'sell' }
  | { kind: 'cross'; left: string; right: string; direction: 'above' | 'below'; params?: Record<string, Record<string, number>> };

export interface StrategyRule {
  mode: 'and' | 'or';
  conditions: FactorCondition[];
  side: 'buy' | 'sell';
  strength?: number; // 默认 2
  reason?: string;
}

export interface StrategyTemplate {
  id: string;
  label: string;
  description: string;
  rules: StrategyRule[];
}
```

评估：`buildFactorCache(candles)` → 逐规则求值 → 命中即 `PartialSignal`。

### S2.3 内置模板（3 个精选）

| id | label | 买入逻辑 | 卖出逻辑 |
|---|---|---|---|
| `trend_confirm` | 趋势确认 | ma_cross 触发买 **AND** macd score>0 **AND** rsi<60 **AND** volume_ratio≥1.2 | ma_cross 触发卖 **OR** rsi>75 |
| `oversold_bounce` | 超卖反弹 | rsi<30 **AND** volume_ratio≥1.5 **AND** close>ma20 | rsi>60 **OR** close<ma20 |
| `breakout_momentum` | 突破动量 | breakout 触发买 **AND** volume_ratio≥2 **AND** ma_trend score>0 | breakout 触发卖 **OR** ma_trend score<0 |

默认启用 `trend_confirm`。

### S2.4 目录分层目标

```
src/
  strategies/              # 独立策略域（本 feature 新建）
    types.ts
    factors/
      index.ts             # 注册表
      ma.ts macd.ts rsi.ts volume.ts breakout.ts boll.ts trend.ts
    engine.ts              # evaluateStrategy / buildFactorCache
    templates/
      index.ts             # 内置模板
      trendConfirm.ts oversoldBounce.ts breakoutMomentum.ts
    index.ts
  quant/                   # 计算与回测（保留 indicators/backtest/scanner/optimize）
    indicators.ts backtest.ts scanner.ts optimize.ts adjustment.ts
  data/                    # 数据层（api/db/cache/sync/repositories 迁入）
    api/ db/ cache/ sync/ repositories/
  features/ components/ hooks/ navigation/ domain/ utils/  # 保持
```

迁移动作：
- `src/api` → `src/data/api`
- `src/db` → `src/data/db`
- `src/cache` → `src/data/cache`
- `src/sync` → `src/data/sync`
- `src/repositories` → `src/data/repositories`
- 全仓 import 路径 `@/api` → `@/data/api` 等（或保留 `@/api` 别名指向新路径，减小改动面）

**决策**：为控制风险，迁移后在 `tsconfig` 增加 path 别名：
- `@/api` → `src/data/api`
- `@/db` → `src/data/db`
- `@/cache` → `src/data/cache`
这样 UI/业务 import 不必批量改，物理目录已分层。

`src/quant/strategies.ts`、`composite.ts` 删除，逻辑并入 `src/strategies/`。
`src/quant/signals.ts` 改为调用 `src/strategies/engine`。

### S2.5 与现有系统衔接

- `SignalEngine` / `StrategyEngine` / `backtest` 调用 `evaluateStrategy(template, candles)`
- `StrategyProfile` 仍持久化到 SQLite；`templateId` 指向内置模板 id
- `computeSignal` 对每个启用的 profile 调引擎，合并为 TradeSignal（沿用加权）

## [S3] Out of Scope

- 不做因子可视化编辑器 UI（本 feature 只做框架与模板）
- 不改行情源 / 数据库 schema
- 不做 ML 因子训练
- 不迁移 `features/` 到 `ui/`

## Tasks

- [x] T1: 创建 `src/strategies/types.ts` + 因子注册表类型 — acceptance: 类型可编译，FactorDef/StrategyTemplate 接口完整 (covers: S2.1 S2.2)
- [x] T2: 实现 7 个因子（ma/macd/rsi/volume/breakout/boll/ma_trend）— acceptance: 每个因子有单测，score/triggered 符合语义 (covers: S2.1)
- [x] T3: 实现 `engine.ts`（buildFactorCache + evaluateStrategy）— acceptance: AND/OR 规则单测通过 (covers: S2.2)
- [x] T4: 实现 3 个内置模板 + 注册导出 — acceptance: STRATEGY_TEMPLATES 含 3 项，默认 trend_confirm (covers: S2.3)
- [x] T5: 目录分层：迁 api/db/cache/sync/repositories → data/，配置 path 别名 — acceptance: tsc 通过，`@/api` 等 import 仍可用 (covers: S2.4)
- [x] T6: 清理 quant/ 中 strategies/composite/signals 旧实现，接线新引擎 — acceptance: SignalEngine/backtest 走新模板，全量测试通过 (covers: S2.5)
- [x] T7: 更新 openspec/strategy spec 与 quant 测试 — acceptance: 新单测全绿，spec 与实现一致 (covers: S2.1-S2.5)
