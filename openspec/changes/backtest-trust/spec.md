# change: backtest-trust — 回测可信化（第二优先）

> **状态：已交付（2026-09-11）**。成本模型 / 前视防护 / 绩效指标 / walk-forward / 基准对比 / 参数扫描均已落地；
> UI 见 `StrategyBacktestScreen`（批量汇总 + 单标的详报 + TopN 参数应用）。

## Why

回测若费用/复权/前视错误，会给出虚高收益，误导实盘决策。必须先把「数字可信」做到位。

## What Changes

### 1. 成本模型

- 佣金：双边，默认 0.025%（可配，最低 5 元）
- 印花税：卖出 0.05%
- 过户费：双边 0.001%
- 可选滑点：固定 bp 或按成交量比例

### 2. 复权正确性

- [x] 默认用**不复权价 + 复权因子**合成（`loadBacktestSeries`）
- [x] 回测区间内遇除权除息，持仓成本与现金正确调整（`corporateActions`：分红加现金/送转加股/成本下调）
- [x] 禁止用「已复权 K 线」直接回测（网络强制 `adjust: 'none'`）

### 3. 前视防护

- `series.slice(0, index+1)` 约束写入文档与单测
- 单测：故意读未来 bar 的策略必须失败/被截断

### 4. 绩效报告

- 总收益 / 年化 / 最大回撤 / 夏普 / 胜率 / 盈亏比
- 权益曲线 + 成交明细表
- 与基准（沪深300）对比（可选）

## Impact

- Affected: `quant/backtest.ts` `quant/adjustment.ts` `features/quant/StrategyBacktestScreen.tsx`
- Tests: 费用敏感性、复权一致性、前视防护

## Acceptance

1. 开启费用后收益率严格下降
2. 除权日持仓市值与现金正确
3. 前视读取被单测拦截
4. 报告指标与手工抽样对得上
