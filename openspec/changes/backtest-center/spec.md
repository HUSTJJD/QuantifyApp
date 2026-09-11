# change: backtest-center — 回测中心与可信执行（本轮）

> **状态：已交付（2026-09-13）**。

## Why

引擎与策略详报已具备，但「我的 → 回测」仍是写死茅台的演示页；详报里 walk-forward/参数扫描初始资金与设置不一致；默认收盘成交偏乐观。

## What

1. **回测中心** `BacktestScreen`：策略列表 → 进入完整 `StrategyBacktest` 报告
2. **引擎** `execution: 'close' | 'nextOpen'`：详报默认**次日开盘**成交
3. **滑点 chips**（0 / 5 / 10bp）并入回测说明
4. **资金口径统一**：walk-forward / gridSearch 用设置页初始资金
5. **POOL_CAP 6 → 12**

## Acceptance

- 回测中心可点策略进详报
- nextOpen 单测：信号当根不成交、次日 open 成交
- 滑点买入价更高
- typecheck:app + backtest 相关测试通过
