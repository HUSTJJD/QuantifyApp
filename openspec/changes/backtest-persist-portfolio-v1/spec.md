# change: backtest-persist-portfolio-v1 — 回测持久化 + 真实组合回测

> **状态：已完成（2026-09-17）**。

## Why

`backtest-engine-v2` 已交付，但其在「Out of Scope」明确遗留两类问题：

1. **回测结果持久化**：每次进 `StrategyBacktestScreen` 都全量重算（池回测可能数十标的），
   低端机/大池体感卡顿。应把结果按配置哈希缓存到本地 SQLite，再进页先读缓存。
2. **真正的组合回测**：`portfolio.ts` 仅等权合成（无资金竞争 / 无 `maxPositions` /
   无逐标的仓位限额）。需要一条「共享资金 + 最多同时持有 N 只 + 超额跳过」的真实组合回测。

## What Changes

### 1. 持久化 `src/quant/backtestCache.ts`（新）+ `src/data/db/schema.ts`

- `schema.ts` 增加 `backtest_cache` 表（key TEXT PK, payload TEXT, created_at）。
- `backtestCache.ts`：`backtestConfigKey(opts)` 生成配置哈希；
  `getCachedBacktest(key)` / `putCachedBacktest(key, result)`，
  SQLite 不可用时回落内存（jest 单测走内存路径）。
- `StrategyBacktestScreen` 计算前先 `getCachedBacktest`，命中则直接渲染；未命中计算后 `putCachedBacktest`。

### 2. 真实组合回测 `src/quant/portfolioBacktest.ts`（新）

- `runPortfolioBacktest(legs, opts)`：各 leg 提供 `equity`（来自单标的 `runBacktest`），
  自动推导「当日是否持仓」与「当日收益」；共享资金 + `maxPositions` 约束，
  超额时按近期动量排序取前 N（资金竞争），换仓计交易成本；产出组合 NAV + 绩效指标
  （复用 `metrics.ts`）。
- 单测：对比「无约束等权」与「maxPositions 受限」的 NAV 差异；验证资金竞争跳过逻辑。

## Acceptance

- 同一配置二次进页不再全量重算（缓存命中，单测验证 key/读写为幂等）。
- `runPortfolioBacktest` 在 desired>maxPositions 时确实限制同时持仓数，且 NAV 合理（非负、可复现）。
- `StrategyBacktestScreen` 在「等权合成」卡片下方新增「真实组合（资金竞争 · 最多 N 只）」卡片：含 maxPositions 步进器、共享资金池 NAV 图与收益/回撤/夏普/日均持仓/持仓覆盖指标，超额时展示日均跳过占比。
- `npm run typecheck:app && npm run test` 通过。
