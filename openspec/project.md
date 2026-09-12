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

结合本地缺口与参考：Opptrix / OpenStock / streetmerchant / moomoo / Webull / 同花顺 / ghostfolio / stock-dashboard：

1–3. ~~mobile-surface-v1 / quant-visibility / onboarding-notify~~ 已交付
4. ~~portfolio-attribution-v2~~ 已交付：行业归因 + NavVsBenchmark（资产/模拟盘）
5. ~~eod-picker-cards~~ 已交付：套餐卡片流 + eod_scan 调度 job
6. ~~sim-paper-deep~~ 已交付：PaperBadge + sim 净值快照/基准
7. ~~alert-notify-harden~~ 已交付：生命周期冷却 + 通道扇出 + 轮询退避模块
8. ~~quant-scheduler~~ 已交付：Job/run 内核 + 自动化设置页
9. ~~stock-decision-card~~ 已交付：详情页决策卡
10. ~~watchlist-radar-line~~ 已交付：雷达副标题（行业映射缓存；报价宽限可再强化）
11. ~~系统推送 / 复权回测 / 除权调整~~ 已交付或并入上述

可选后续：~~涨跌色配置~~ 已交付；~~告警生命周期 UI + 轮询退避~~ 已交付；~~模拟成交时间线~~ 已交付；~~typecheck:app + QA 清单~~ 已交付。

**仍待交付**：
1. ~~regime-recommend-chips~~ 已交付
2. ~~加自选报价宽限 / 雷达行业~~ 已交付
3. ~~告警创建预填价~~ 已交付
4. ~~NL 筛股（轻量关键词→扫描）~~ 已交付：`matchNlScan` + 搜索页入口
5. 真机按 `docs/QA_CHECKLIST.md` 走一遍并记问题
6. 可选：NL 扩展更多条件、策略绩效曲线进专属模拟盘

## 质量门

- `npm run typecheck:app` — 仅 App 源（排除 stock-sdk）
- `npm run test`
- `docs/QA_CHECKLIST.md` — 真机验收
