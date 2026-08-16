# 行情源能力打通 — 任务清单（Task List）

> 目标：多源（fuyao / hithsa / stock-sdk）统一封装，**顶层接口跨源通用**；
> 每个能力先"吃透源"（协议/字段/取值/前后端对齐），详尽注释；
> 重复能力自动选最稳源；**榨干每个源能力，不漏接**。
>
> 本文件是总入口，串联下列调查报告（均在 `docs/api/sources/`）：
> - `README.md` —— 方法论 + 清单生成脚本 + 封装注释模板 + 选源方案
> - `stock-sdk.capabilities.md` / `fuyao.capabilities.md` / `hithsa.capabilities.md` —— 三源权威能力清单
> - `METHOD_REVIEW.md` —— 88 个顶层接口的逐项审查（🔴 问题 / ➕ 缺口）
>
> 勾选框：`[ ]` 待办 · `[x]` 已完成（本轮已落地的预先勾掉）。

---

## 0. 已交付（本轮调查成果）

- [x] 三份能力清单：stock-sdk（~80 方法/20 命名空间）、fuyao（12 Resource 类 + 字段级 Params）、hithsa（34 已接端点）
- [x] 方法论 README：清单生成脚本 + 封装注释模板 + 多源选源方案
- [x] 修正上轮错误封装：板块改用 `board.industry.list()` 真实字段（`getBoardQuotes`/`getStockIndustryBoard`），更新测试 fixture
- [x] `getStockIndustryBoard` 按模板写全详尽协议注释（样板）
- [x] `SourceRouter` 稳定优先调度：按 `ApiStabilityStats.score()` 降序，冷启动退化配置顺序，`stableRouting` 可关（测试通过）
- [x] 78 接口审查报告 `METHOD_REVIEW.md`（P0-A 去重后方法数 88→78）

---

## 1. 待办总览（按优先级）

| 批次 | 主题 | 风险 | 价值 | 状态 |
|---|---|---|---|---|
| **P0-A** | 消除重复 / 弱类型（收拾门面） | 低 | 中 | **已完成** |
| **P0-B** | 填能力缺口（期权/期货/北向/筹码/融资融券/概念板块） | 中 | 高 | **已完成** |
| **P1-A** | 扩展能力归一化（弱类型→强类型） | 中 | 中 | **已完成** |
| **P1-B** | 多源汇总增强（资金流榜/交易日状态等） | 低 | 中 | **已完成** |
| **P2** | 持续：升版 diff + 闭环接入 | — | 持续 | **本轮完成** |

---

## 2. P0-A：消除重复 / 弱类型（低风险，先做） —— 已完成

> 对应 `METHOD_REVIEW.md` 问题 1/3/4/5。这些不新增能力，只整理自家门面，回归风险低。
> 接口方法数：88 → 78（删 11 弱类型/市场别名 + 增 1 `getIntraday`）。

- [x] **统一行情/K线/分时入口**（问题1）
  - 行情/K线：核心 `getQuotes(Symbol[])` / `getKline(KlineParams)` 已是统一入口（按 `symbol.exchange` 分源）；
  - 新增 `getIntraday(IntradayParams)` 统一分时（stock-sdk 实现 A 股 timeline；HK/US 抛 3004）；
  - 删除 `getHkQuotes`/`getUsQuotes`/`getHkKline`/`getUsKline`/`getStockTimeSharing`/`getUsTimeSharing`/`getTimeSharing`；
  - 业务层本就未调用这些别名，仅 catalog/契约测试维护，删除零回归。

- [x] **删重复弱类型接口**（问题3）
  - 删 `getStockLimitUpPool`（保留核心 `getLimitUpPool` 强类型）；
  - 删 `getDragonTiger`（保留核心 `getDragonTigerList` 强类型）；
  - 删基金弱类型重复对 `getFundInfo`/`getFundHistory`（由核心 `getFundProfile`/`getFundNav`/`getFundHistorical` 覆盖）；
  - 保留基金扩展中的独有能力（`getFundList`/`getFundRank`/`getFundTheme` 等 17 项）。

- [x] **补无契约接口**（问题5）
  - `getLimitUpLadder(): Promise<LimitUpLadder>` —— 定 `LadderBoardKey`/`LadderStock`/`LadderDay`/`LimitUpLadder`（对齐 fuyao `LimitUpLadderData`）；
  - fuyao/hithsa：日期→板位矩阵直映；stock-sdk：由涨停池合成单日天梯（2 板及以上）。

- [x] **入参枚举化**（问题4）
  - `listTickers`：`exchange?: Exchange`、`assetType?: AssetType`；
  - `getFundNav(range?: FundNavRange, navType?: FundNavType)`（对齐 fuyao `NavRange`/`navType`）；
  - `getFundHolders(mergeScope?: FundMergeScope)`（`all|merged|separate`）；
  - `getFinancialIndicators(report: FinancialReportPeriod)`（`yyyy-1|yyyy-2|yyyy-3|yyyy-4`，修正 catalog 错误夹具 `2024-12-31`→`2024-4`）；
  - 同步修正 `MarketSync` 非法 `exchange:'SH,SZ'`（fuyao 不消费该字段）。

- [x] **验收**：全量测试通过；`methods.ts` 方法数 88→78；`getLimitUpLadder` 不再返回裸 `unknown`。

---

## 3. P0-B：填能力缺口（榨干源，最高价值） —— 已完成

> 对应 `METHOD_REVIEW.md` 第二节。源已支持、App 完全没接入的"漏点"。
> 接口方法数：78 → 99（+21）。实现源：stock-sdk（唯一覆盖源；fuyao/hithsa 无对应端点）。
> 每个按闭环落地：① `methods.ts` 签名 ② `types.ts` 强类型 ③ StockSdkSource 实现 + 协议注释 ④ catalog/expectations ⑤ 契约测试。

### 期权 `options.*`（4 方法）
- [x] `getOptionQuotes`（index/commodity T 型报价）、`getOptionKline`（index/commodity/etf 日K）、`getOptionCffexQuotes`、`getOptionLhb`
  - 类型：`OptionTQuoteResult`/`OptionKlineBar`/`CffexOptionQuote`/`OptionLhbItem`
  - 注：ETF 无 T 型报价端点；`getOptionQuotes` 仅支持 index/commodity

### 期货 `futures.*`（6 方法）
- [x] `getFuturesKline`、`getFuturesGlobalSpot`、`getFuturesGlobalKline`、`getFuturesInventorySymbols`、`getFuturesInventory`、`getFuturesComexInventory`
  - 类型：`FuturesKlineBar`/`GlobalFuturesQuote`/`FuturesInventoryPoint`/`ComexInventoryPoint`

### 北向资金 `northbound.*`（5 方法）
- [x] `getNorthboundMinute`、`getNorthboundSummary`、`getNorthboundHoldingRank`、`getNorthboundHistory`、`getNorthboundIndividual`
  - 类型：`NorthboundMinutePoint`/`NorthboundFlowSummaryItem`/`NorthboundHoldingItem`/`NorthboundHistoryPoint`/`NorthboundIndividualPoint`

### 筹码分布 `chips.*`（1 方法）
- [x] `getChipDistribution({symbol, range?, includeHistogram?, decimals?})` 覆盖 cn/hk/us
  - 类型：`ChipDistributionPoint`（获利比例/平均成本/70·90% 成本区间）

### 融资融券 `margin.*`（2 方法）
- [x] `getMarginAccountInfo`、`getMarginTargetList`
  - 类型：`MarginAccountStat`/`MarginTargetStat`

### 概念板块 `board.concept.*`（3 方法）
- [x] `getConceptBoards`、`getConceptBoardConstituents`、`getConceptBoardKline`
  - 类型：`ConceptBoardItem`/`ConceptBoardConstituentItem`（与行业板块 `getStockIndustryBoard` 对称）
  - 注：`spot` 是 KV 结构，与行业板块同坑，统一走 `list()`

- [x] **验收**：tsc 通过；全量测试 445 passed；stock-sdk 声明能力 28→51；catalog 目录 99 项完整。

---

## 4. P1-A：扩展能力归一化（弱类型 → 强类型） —— 已完成

> 对应 `METHOD_REVIEW.md` 问题2。接口方法数：99 → 94（删 4 涨跌停弱方法 + 删 2 资讯别名 + 增 1 跌停池）。

- [x] 股东类：`getHolders`/`getLargestHolders`/`getHolderChanges` → `HolderParams{symbol}`；`HolderItem` 强类型（holdShares/holdRatioFloat/holdRatioTotal/holdMarketValue/reportDate）。
  - 注：三源均无股东端点，签名就绪、实现待源支持。
- [x] 资金流类（stock-sdk fundFlow 已接通）：
  - `getMainForce({symbol, period?})` → `fundFlow.individual`
  - `getStockFundsFlowing({period?, limit?})` → `fundFlow.rank`
  - `getStockIndustryFundsFlowing` / `getStockHotIndustry` → `fundFlow.sectorRank`
  - `getStockTodaySurge` → `marketEvent.stockChanges('rocket_launch')`
  - `getStockIndustryBoard({limit?})` 参数收强类型
- [x] 涨停/跌停：删 4 个弱方法 `getStockLimitUp/Down/UpList/DownList`（无源实现）；新增 `getLimitDownPool`（fuyao `limitDownPool`，与 `getLimitUpPool` 对称，返回 `LimitDownStock`）。
- [x] 资讯：合并 `getHKNews`/`getFinanceNews` 为 `getNews({market?, kind?, symbol?, limit?})`；`NewsItem`/`AnnouncementItem` 强类型；同步修正 `features/stock/news.ts`。
- [x] 财务：`FinancialReport` 去掉 `[k:string]:unknown`；`ProfitForecast` 定真实字段；fuyao/hithsa `getProfitForecast` 从「返回空数组冒充成功」改为明确 3004 并移出 capabilities。
- [x] **验收**：tsc 通过；全量测试 445 passed；catalog 目录 94 项完整。

---

## 5. P1-B：多源汇总增强 —— 已完成

> 接口方法数：94 → 107（+13）。实现源：stock-sdk（+ fuyao 炸板池）。

- [x] 资金流榜：`fundFlow.rank` → `getStockFundsFlowing`（P1-A 已接）；`sectorHistory` → `getSectorFundFlowHistory`
- [x] 行业板块成分/K线：`getIndustryBoardConstituents` / `getIndustryBoardKline`
- [x] 龙虎榜细分：`getDragonTigerInstitution` / `getDragonTigerBranchRank` / `getDragonTigerSeatDetail`
- [x] 大宗交易细分：`getBlockTradeMarketStat` / `getBlockTradeDailyStat`
- [x] 交易日状态：`isTradingDay` / `nextTradingDay` / `prevTradingDay`（核心方法）
- [x] 分红明细：`getDividendDetail`
- [x] fuyao 未用端点：`limitBreakPool` → `getLimitBreakPool`（炸板池）
- [x] **验收**：tsc 通过；全量测试 445 passed；catalog 目录 107 项完整。

### 仍闲置（源专属，未进契约）
- stock-sdk：`getStockFundFlow`、`getBoardQuotes`、`getFund*`、ETF 期权细节端点、`screen`
- fuyao：`auction.snapshot`、`shortTermBenchmark`、`dumps`

---

## 6. P2：持续流程 —— 本轮已完成升版 diff + 闭环补录

- [x] 每接入一个能力，走闭环：改 `methods.ts` 签名 → 改 `types.ts` 返回类型 → 源封装实现 → 一致性测试断言 → 详尽协议注释。
- [x] 定期重跑清单生成脚本，diff `stock-sdk` / fuyao 升版：本轮 stock-sdk 2.4.2、fuyao 1.0.2，能力清单与 `docs/api/sources/*.capabilities.md` 零差异（无新增命名空间）。
- [x] 闭环补录 15 项闲置高价值能力（接口方法 107 → 122）：
  - stock-sdk：`getMarketFundFlow` / `getOptionEtfMonths` / `getOptionEtfExpireDay` / `getOptionEtfMinuteKline` /
    `getKlineWithIndicators` / `getKlineSignals` / `getStockChangeEvents` / `getIndividualChangeEvents` /
    `getDragonTigerStockStats` / `getFundDividendList` / `getFundRankHistory` / `getLargeOrderRatios` / `getMarketStatus`
  - fuyao：`getAuctionSnapshot` / `getShortTermBenchmark`
- [x] 在应用界面自检屏（`SourceTestScreen`）纳入新接口的"源覆盖矩阵"（按能力分组：支持/可测/总数，随 catalog 自动演进）。

### 策略层 screen/backtest 结论
- stock-sdk 的 `screen` / `backtest` 是**客户端纯函数**（过滤数组 / 回放 K 线），**不进** DataSourceMethod 契约；
- 本地路径：`quant/scanner.scanMarket` + `quant/backtest.runBacktest`（已有）；
- 远程快筛：新增 `quant/remoteScreen.ts`（`getStockFundsFlowing` / `getStockChangeEvents` + stock-sdk `screen` 纯筛选），不依赖本地 K 线库。

### 仍闲置（有意保留为源专属）
- stock-sdk 别名：`getQuotesHK/US`、`getKlineHK/US`、`getTodayTimeline*`（已被统一 getQuotes/getKline/getIntraday 覆盖）
- stock-sdk 原始透传：`getStockFundFlow`、`getSectorFundFlowRank`（已被 getMainForce/getStockIndustryFundsFlowing 覆盖）
- 选股/回测：`screen` / `backtest`（需另立契约与策略层）
- 板块 spot/minuteKline：KV/分钟细节，消费方走 list + getKline 即可
- fuyao：`dumps`（Parquet 全量导出，属离线批处理）

---

## 7. 标准落地模板（每个能力必带，摘自 README）

```ts
/**
 * getXxx —— 能力一句话说明
 * 协议（协议层写清各源怎么调、字段怎么映射）：
 *  - stock-sdk: sdk.xxx.method(args) → 原始字段 A/B/C（字段含义、取值）
 *  - fuyao:     client.resource.method(params) → 原始字段 X/Y（Params 约束：必填/枚举/非法值码）
 *  - hithsa:    /api/... 端点 → 原始字段 M/N
 * 返回字段（跨源对齐后的统一字段与降级策略）：
 *  - field1: 来自 ...；某源缺失时降级为 null
 * 失败降级：全部源 3004/空 → 抛 DataSourceError；部分源成功即可
 */
```

## 8. 文件索引

```
docs/api/sources/
├── TASKS.md                      ← 本文件（总任务清单）
├── README.md                     方法论 + 生成脚本 + 注释模板 + 选源方案
├── METHOD_REVIEW.md              88 接口逐项审查（🔴/➕）
├── stock-sdk.capabilities.md     能力清单（~80 方法）
├── fuyao.capabilities.md         能力清单（12 Resource + Params 字段）
└── hithsa.capabilities.md        能力清单（34 已接端点）
```
