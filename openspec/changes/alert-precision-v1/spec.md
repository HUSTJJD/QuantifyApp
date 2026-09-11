# change: alert-precision-v1 — 买卖提示精准化（下一轮）

> **状态：进行中（2026-09-17）**。

## Why

`signal-to-trade-loop` / `alert-notify-harden` 已交付，信号→告警已通，但提示仍是「买入/卖出」二元，
且存在两类可优化点：

1. **分级提示**：同一方向信号，持有仓与空仓应区分「买入 vs 加仓」、减仓 vs 全卖，帮助用户决策。
2. **与持仓联动 / 降误报**：卖出提示应仅在持有该标的时出现；买入提示应避免在已重仓时重复轰炸；
   单根 bar 的噪声信号应经「连续确认」过滤后再推送，降低假阳性。

## What Changes

### 1. `src/quant/signalHints.ts`（新）

- `gradeSignalHint(sig, heldQty)`：
  - buy + heldQty>0 → `加仓`；buy + heldQty==0 → `买入`
  - sell + heldQty>0（强）→ `减仓`/`卖出`；sell + heldQty==0 → `不提示`（返回 null）
- `isHintActionable(sig, { heldQty, maxPositionPct })`：持仓联动门控。
- `confirmSignal(recentSides, sig, minBars)`：最近 `minBars` 根同方向才确认，降误报（纯函数）。

### 2. 接入

- `signalAlerts.signalsToAlertEvents` 增加可选 `grade` 与 `holdings` 参数，
  经 `gradeSignalHint` / `isHintActionable` 过滤后再产出告警，消息带分级文案。
- 单测覆盖分级、持仓门控、连续确认。

## Acceptance

- 空仓收到 buy 提示为「买入」，持仓收到 buy 提示为「加仓」。
- 空仓收到 sell 提示被抑制（不推送）。
- 单根噪声信号（无连续确认）被 `confirmSignal` 否决。
- `npm run typecheck:app && npm run test` 通过。
