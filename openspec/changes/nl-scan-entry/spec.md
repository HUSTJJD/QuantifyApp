# change: nl-scan-entry — 关键词直达扫描（轻量问财）

> **状态：已交付（2026-09-13）**。

## Why

用户在搜索框说「放量 / 金叉 / 多头」时，应直达对应扫描，而不是只搜代码。

## What

- `src/quant/nlScan.ts`：关键词 → 套餐 + 额外条件（量比/新高/MACD/MA）
- 搜索页：命中意图时顶部卡片「扫描：…」；空态展示「试试说条件」
- `EodPicker` 支持 `initialPreset` / `extraCriteria`
- 导航：Search → EodPicker 带参

## Acceptance

- 输入「放量」出现扫描卡片并可进尾盘页预选放量套餐
- 单测覆盖匹配与否定例
