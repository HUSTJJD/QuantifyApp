# change: portfolio-attribution-v2 — 组合行业归因与基准对比（下一阶段第一优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。数据层已就绪：`getIndustryBoardConstituents` / `quant/benchmark.ts` / `computeNavMetrics`；对标 ghostfolio X-Ray、moomoo 组合分析、头部 App「净值 vs 大盘」心智。

## Why

资产页目前只有「个股盈亏贡献条」，用户无法回答：

- 哪个**行业**在赚/亏钱？
- 组合相对**沪深300**是超额还是跑输？
- 回撤是市场贝塔还是自己的选股？

`benchmark.ts` 已实现超额收益/跟踪误差/IR，行业板块 API 齐全，却未接入资产与模拟盘。本变更把已有数据变成决策视图。

## What Changes

### 1. 持仓 → 行业映射

- 用 `marketData` 行业成分/`getStockIndustryBoard` 把持仓代码映射到行业（缺失归入「未分类」）
- 内存缓存映射表（TTL 24h），失败不阻塞资产页

### 2. AssetScreen 行业归因视图

在个股归因旁增加「行业」切换：

| 展示 | 说明 |
|------|------|
| 行业条形 | 权重 + 对总盈亏贡献（红涨绿跌） |
| 集中度 | 最大行业占比、HHI 简化为 Top1/Top3 |
| 点击行业 | 展开该行业下持仓列表 |

### 3. 组合净值 vs 基准

- 拉取沪深300（可配）日 K，与资产快照序列对齐（`alignByDate`）
- 双线图：组合净值（归一化 100）vs 基准
- 指标卡：区间收益、超额收益、最大回撤、信息比率（复用 `computeBenchmarkMetrics`）
- 快照不足 2 点时展示空态引导

### 4. 模拟盘接入同一套指标

- `SimulationScreen` / `StrategySimScreen`：交易日自动写净值快照
- 同一「净值 vs 基准」组件（抽 `src/features/asset/NavVsBenchmark.tsx`）
- 模拟盘默认初始资金归一化起点

## Impact

- Affected: `src/quant/portfolioPerf.ts`（行业归因纯函数）`src/features/asset/AssetScreen.tsx` 新 `NavVsBenchmark` / `IndustryAttribution` `src/features/simulation/SimulationScreen.tsx` `StrategySimScreen` `src/quant/benchmark.ts`（复用）
- Storage: 可选 `sim_nav_snapshot` 或复用现有 Portfolio 快照通道
- Risks: 行业映射覆盖率不足时显式展示「未分类」；基准 K 线失败降级为仅组合曲线

## Acceptance

1. 有 ≥3 只不同行业持仓时，行业归因条与个股贡献之和一致
2. 净值曲线同时显示组合与沪深300，超额收益可算出
3. 模拟盘跑若干笔后可见绩效卡（夏普/回撤/超额）
4. 无基准数据时优雅降级，不崩资产页
