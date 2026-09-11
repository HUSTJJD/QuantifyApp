# change: quant-loop-polish — 量化闭环打通打磨（本轮）

> **状态：已交付（2026-09-12）**。

## Why

扫描→候选→信号→模拟→摘要主链路已通，但仍有断点：市场同步未挂进统一调度、策略专属模拟盘无 PAPER 标识、工作流页看不出扫描来源、搜索防抖偏短。

## What Changes

1. **market_sync 挂调度**：`registerJobKind('market_sync')` 包装 `runBackgroundSync`，自动化页可见
2. **StrategySim PaperBadge**：策略专属模拟盘与全局模拟盘同级视觉隔离
3. **工作流来源角标**：解析 snapshot `criteria.source`（eod → 「尾盘」Tag）
4. **搜索防抖 300ms**：对齐 OpenStock

## Acceptance

- 自动化页可「立即运行」市场同步
- 专属模拟盘顶部有 PAPER 角标
- 尾盘扫描快照在工作流显示「尾盘」
- typecheck:app + 相关单测通过
