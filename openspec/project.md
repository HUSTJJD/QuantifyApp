# QuantifyApp — 个人量化交易 App

## 背景

本 App 是面向 A 股 / 港股 / 美股的**个人量化工具**：行情浏览、策略信号、回测、模拟盘与一键跟单。

数据源（多源路由 + 兜底）：

| 源 | 覆盖 |
|---|---|
| fuyao（同花顺官方 SDK） | A 股行情 / K 线 / 财务 / 估值 / 涨跌停 / 交易日 / 基金 |
| hithsa（同花顺 REST） | A 股行情 / K 线 / 财务 / 估值 / 指数 |
| stock-sdk（兜底） | A / 港 / 美行情、期权、期货、北向、筹码、两融、概念板块、龙虎榜 |

本地存储：SQLite（K 线 + 复权因子、领域行情表、用户数据）。

## 目标用户

个人投资者 / 量化爱好者：手机上看盘、跑策略、模拟盘练手，再跳同花顺实盘。

## 非目标

- 不做实盘券商下单
- 不做多用户 / 云端策略市场
- 不做高频 tick 级交易

## 能力地图（规格索引）

| 能力 | 规格 | 成熟度 |
|---|---|---|
| 行情与自选 | `specs/market-data` `specs/watchlist` | 基础可用 |
| 策略信号 | `specs/signals` | 可用（加权合并 + 解释） |
| 回测 | `specs/backtest` | 可用（成本/风控/样本外/基准/参数扫描） |
| 模拟盘 | `specs/simulation` | 基础可用 |
| 选股扫描 | `specs/screening` | 可用（本地扫描 + 快照 + 候选池） |
| 一键跟单 | `specs/follow-trade` | 可用（跟单 + 同花顺跳转） |
| 策略引擎 | `specs/strategy` | 可用（多因子 + 分组调参 + 风控） |
| 告警 | `specs/alerts` | 可用（价格/指标/策略信号 + 规则管理） |

## 下一阶段主攻（按 ROI）

基于外层参考 App（Opptrix / OpenStock / stock-dashboard / ghostfolio）与当前 UI 基线：

1. ~~mobile-surface-v1~~ 已交付：Token / 骨架屏 / 自选密度 / FlashList / 资产页去 paper
2. ~~quant-visibility~~ 已交付：策略 Tab 脉冲 + 快捷入口；热力图多维
3. ~~onboarding-notify~~ 已交付：首启 3 屏 + 盘后摘要（应用内触达）
4. **组合归因增强**：行业/因子维度归因、与基准对比的绩效曲线
5. **尾盘选股卡片流**（quant-visibility 可选延伸，stock-dashboard EodPicker）
6. ~~系统推送通知~~ 降级为 onboarding-notify 内的本地/应用内通知；厂商推送仍可延后
7. ~~复权回测入链路~~ 已交付：`loadBacktestSeries` 不复权 + 本地因子
8. ~~除权日持仓调整~~ 已交付：`runBacktest({ corporateActions })` 分红/送转/配股
