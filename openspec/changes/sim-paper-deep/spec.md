# change: sim-paper-deep — 模拟盘绩效深化与 Paper 视觉隔离（下一阶段第三优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。对标 Webull paperTrade「独立视觉 + 一键重置 + 与实盘工具同构」、moomoo 模拟盘；补足模拟盘「只有绝对盈亏」的决策缺口。

## Why

模拟盘已有 A 股撮合与持仓/委托/成交，但：

1. 无法判断「策略是否跑赢大盘」（无净值曲线、无基准）
2. 视觉上与真实账户无区分，误操作风险（Webull 用独立主题解决）
3. 重置/初始资金入口深，练习成本高

个人量化的核心路径是「信号 → 模拟验证 → 同花顺实盘」，模拟盘必须可信且安全。

## What Changes

### 1. Paper 视觉隔离（低代码量、高安全感）

- 模拟盘区域顶部 **「模拟盘 · PAPER」角标/水印条**（primarySoft 底 + 文案）
- Tab 标题或吸顶条固定标识；详情/交易页返回时保持
- 可选：模拟盘卡片边框用 `primary` 描边（Light/Dark 均可辨）
- **不**改全局主题（避免用户切换页迷失）

### 2. 净值快照与绩效卡

- 交易日聚焦时自动 `addSnapshot`（对齐 Asset 节奏，键空间隔离：`sim_*`）
- 绩效卡：累计收益、年化、最大回撤、夏普（`computeNavMetrics`）
- 基准对比：复用 `NavVsBenchmark`（依赖 portfolio-attribution-v2 交付组件，本变更可独立先上绝对绩效）

### 3. 交易记录时间线（ghostfolio Activity）

- 成交列表改为时间线：日分组 + 买卖色点 + 盈亏（若有平仓）
- 支持按标的筛选

### 4. 快速重置与练习模式

- 总览区显式「重置」按钮（现长路径收拢）
- 可选初始资金：10万 / 50万 / 100万
- 重置二次确认文案强调「仅模拟盘」

### 5. 策略专属模拟盘（StrategySim）同步

- 同样 Paper 角标 + 绩效卡入口
- 与策略开关状态联动展示（自动交易中/已停）

## Impact

- Affected: `src/features/simulation/SimulationScreen.tsx` `TradeScreen` `StrategySimScreen` 新 `src/features/simulation/PaperBadge.tsx` `simNavStore` 或复用快照仓库
- Storage: 模拟净值快照与资产快照分键
- Risks: 与真实资产快照串键 — 必须隔离；绩效卡在无快照时只显示累计盈亏

## Acceptance

1. 模拟盘与资产页视觉可区分（角标/水印持续可见）
2. 至少 2 个快照日后可见净值曲线与夏普/回撤
3. 重置一步可达且有确认
4. 成交时间线按日分组正确
