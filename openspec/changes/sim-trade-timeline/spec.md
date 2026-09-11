# change: sim-trade-timeline — 模拟盘成交时间线与雷达强化（下一阶段第四优先）

> **状态：已交付（2026-09-12）**。。sim-paper-deep 规划了成交时间线未做；watchlist-radar-line 的报价宽限与行业字段仍简化。

## Why

1. 模拟盘「成交」仍是平铺列表，无法按日复盘（ghostfolio Activity）。
2. 自选雷达行缺行业/估值/资金；新加自选易短暂「--」。

## What Changes

### 1. 成交时间线

`SimulationScreen` trades Tab：

- 按日分组（`YYYY-MM-DD` 头）
- 行：时间 · 买/卖色点 · 名称 · 价×量 · 费用
- 支持按标的筛选（顶部 chips：全部 | 某持仓）
- 平仓盈亏若有则右侧显示

### 2. 雷达行强化

- 接 `peekIndustryOf`（行业映射已缓存）
- 可选 extraVal：估值 TTM PE（详情已有；列表可延后或仅缓存命中时显示）
- 主力净额：仅当 `fundFlow` 缓存命中时显示，禁止列表内逐行请求

### 3. 加自选报价宽限

- `addToWatchlist` 成功后 `getQuotes([symbol])` 单拉一次
- 失败：用详情 lastPrice 写入内存 `addedPrice` map
- 15s 内 WatchRow 价格区优先用 addedPrice，不显示失败红字

## Impact

- Affected: `SimulationScreen.tsx` `WatchRadarLine.tsx` `WatchlistTabScreen.tsx` 新 `addedPriceCache.ts`
- Risks: 无网络额外串行 — 宽限仅在加自选一次触发

## Acceptance

1. 成交按日分组，买卖着色正确
2. 雷达行在有缓存时显示行业
3. 新加自选 15s 内无失败态，价格可用
