# 顶层通用封装接口审查（methods.ts / types.ts）

> 审查视角：**跨源通用性**。上层（feature / UI）应完全不感知数据来自 fuyao / hithsa / stock-sdk，
> 也不感知市场（A/HK/US）。凡"把市场或源编码进方法名""入参/返回退化成 `[k:string]: unknown` 或 `unknown`"
> "同一语义存在多套签名" 的，都是本次要标的问题。
>
> 图例：🟢 良好 · 🟡 可改进 · 🔴 问题 · ➕ 应有但缺失

---

## 一、五大共性问题（按严重度）

### 1. 🔴 市场维度被编码进方法名，破坏"顶层统一"
`getQuotes(Symbol[])` 已是正确的通用形态，但并列存在：
- `getHkQuotes({codes:string[]})` `getUsQuotes({codes:string[]})`
- `getHkKline(HkKlineParams)` `getUsKline(UsKlineParams)`
- `getTimeSharing / getStockTimeSharing / getUsTimeSharing`（三分时）
- `getHKNews`（资讯按市场拆）

**问题**：上层必须"知道这是港股/美股 → 调不同方法"，且 `codes:string[]` 丢了 `Symbol.exchange/name`，
把市场格式（如 `00700.HK`）的拼装责任推回上层。这与"上层不感知源/市场"直接冲突。
**建议**：行情/ K线/ 分时统一为 `getQuotes(Symbol[])` / `getKline(KlineParams)` / `getIntraday(symbol: Symbol, ...)`，
由 `SourceRouter` 按 `symbol.exchange` 分源（fuyao 只 A股 → fallback 到 stock-sdk 的 hk/us 命名空间）。
保留 `getHkQuotes` 等作为"显式指定市场"的便捷别名也可，但**入参应收敛为 `Symbol[]`**。

### 2. 🔴 扩展能力的返回类型几乎全是"弱类型透传"，没有跨源归一化
`types.ts` 中大量 `*Item` 类型（MainForceItem / FundsFlowingItem / IndustryBoardItem /
DragonTigerItem / TimeSharingItem / 全部 Fund*Item 等）字段都是 `?:` + `[k:string]:unknown`。
这意味着：不同源返回不同字段、没有统一映射，上层拿到的本质还是"源原始结构"。
对比核心方法（Quote/Candle/DragonTigerList 等）是真正归一化的强类型。
**建议**：对每个扩展能力，先定"跨源都有的字段"做强类型，源特有字段再挂可选扩展位；
不要直接用 `[k:string]:unknown` 兜底了事（那是 bridge 内部的事，不应暴露为顶层契约）。

### 3. 🔴 同一语义存在"核心强类型 + 扩展弱类型"两套，且互相重复
- 涨停池：`getLimitUpPool`(核心, `ListResult<LimitUpStock>`) ↔ `getStockLimitUpPool`(扩展, `LimitUpPoolItem[]`)
- 龙虎榜：`getDragonTigerList`(核心, `DragonTigerList`) ↔ `getDragonTiger`(扩展, `DragonTigerItem[]`)
- 基金：核心 `getFundProfile/Holdings/Nav/Returns/Holders/...`(强 `FundProfile` 等)
  ↔ 扩展 `getFundInfo/History/Rank/...`(弱 `FundInfo/ FundHistoryItem/ ...`)，两套并存、字段口径不一。

**建议**：每个语义只留一套强类型接口；弱类型那套要么删除，要么降级为内部 bridge 类型。

### 4. 🔴 入参退化成 `{code:string; [k:string]:unknown}` 甚至 `unknown`
`listTickers(opts?: {exchange?: string; ...})`（核心方法却用 `string` 而非 `Exchange`/`AssetType` 枚举）、
`getFundNav(..., range?: string, navType?: string)`、`getFundHolders(..., mergeScope?: string)`、
`getFinancialIndicators(params: IndicatorsParams)`（`report:string`）、
以及大量 `{code, [k]:unknown}` 入参——把"不知道该放什么字段"用索引签名掩盖了。
**建议**：对照 `fuyao.capabilities.md` 的 Params 枚举（如 `assetType` 非法值服务端返回 1003），把已知的枚举/取值范围收到入参类型里。

### 5. 🔴 完全无契约的接口
- `getLimitUpLadder(): Promise<unknown>` —— fuyao 有强类型 `LimitUpLadderData`，这里却返回 `unknown`，上层无法消费。
**建议**：补 `LimitUpLadder` 返回类型。

---

## 二、➕ 缺口清单（源上能拿，但接口里没有——"没榨干源"）

对照三份能力清单，`stock-sdk` 的能力被接进 88 接口的不到 1/3。高价值缺口：

| 优先级 | 缺失能力（源命名空间） | 说明 |
|---|---|---|
| P0 | **期权 `options.*`**（~10 方法） | index/etf/commodity 的 spot/kline、cffex.quotes、lhb。App 完全没衍生品行情 |
| P0 | **期货 `futures.*`**（6 方法） | kline / globalSpot / globalKline / inventory / comexInventory |
| P0 | **北向资金 `northbound.*`**（5 方法） | minute / summary / holdingRank / history / individual |
| P0 | **筹码分布 `chips.*`**（3 方法） | cn/hk/us 筹码峰，实战极强但接口无 |
| P0 | **融资融券 `margin.*`**（2 方法） | accountInfo / targetList |
| P0 | **概念板块 `board.concept.*`**（5 方法） | A股概念炒作核心，接口只有行业板块 |
| P1 | 行业板块成分/ K线 `board.industry.constituents/kline` | 现有 `getStockIndustryBoard` 只取 list |
| P1 | 龙虎榜细分 `dragonTiger.institution/branchRank/seatDetail` | 现有只到 list 粒度 |
| P1 | 大宗交易细分 `blockTrade.marketStat/dailyStat` | 现有 `getBlockTrade` 只按 code |
| P1 | 资金流榜 `fundFlow.rank` / 行业历史 `sectorHistory` | 现有只有单股主力 + 行业榜 |
| P1 | 交易日状态 `calendar.marketStatus/isTradingDay/next/prev` | 现有只有 `getTradingDays`（全量列表） |
| P1 | 分红明细 `reference.dividendDetail` | 现有 `getAdjustmentFactors` 只到除权因子 |

fuyao 与 hithsa 的已接方法基本都在 88 内（fuyao 的基金细分 `FundManagersResource` 等未全部暴露，但非 P0）。

---

## 三、域逐项审查表（覆盖 88 方法）

### 核心方法（34）
| 方法 | 签名摘要 | 评级 | 关键问题 / 建议 |
|---|---|---|---|
| `search` | `(SearchParams) => Instrument[]` | 🟢 | 良好；`name?:string` 已含 |
| `listTickers` | `(opts?:{exchange?:string;assetType?:string;...})` | 🟡 | exchange/assetType 应改 `Exchange`/`AssetType` 枚举（fuyao 非法值返 1003） |
| `getQuotes` | `(Symbol[]) => Quote[]` | 🟢 | 通用范本 |
| `getOrderBook` | `(Symbol) => OrderBook` | 🟢 | 五档；若需十档可加可选 `level` |
| `getKline` | `(KlineParams) => Candle[]` | 🟢 | 范本；但 HK/US 被拆成 `getHkKline/getUsKline`（见扩展 🔴） |
| `getAdjustmentFactors` | `(Symbol,from?,to?) => AdjustmentFactor[]` | 🟢 | 与 fuyao `AdjustmentFactorsParams`(from/to=YYYY-MM-DD) 对齐 |
| `getValuations` | `(Symbol[]) => Valuation[]` | 🟢 | |
| `getIncomeStatements`等3 | `(HistoricalFinancialParams) => ...[]` | 🟢 | |
| `getFinancialIndicators` | `(IndicatorsParams) => FinancialIndicator[]` | 🟡 | `report:string` 应枚举化 |
| `getFinancials` | `(code) => FinancialReport[]` | 🔴 | `FinancialReport` 带 `[k]:unknown`，未归一化 |
| `getProfitForecast` | `(code) => ProfitForecast[]` | 🔴 | `ProfitForecast` 完全是 `{[k]:unknown}`，无契约 |
| `listIndices` | `(tag?:IndexTag) => IndexInfo[]` | 🟡 | `IndexTag` 分类（cn_concept/region/tszs/industry）需确认三源对齐 |
| `getIndexConstituents` | `(Symbol) => IndexConstituent[]` | 🟢 | |
| `getIndexQuotes` | `(Symbol[]) => Quote[]` | 🟢 | |
| `getIndexKline` | `(KlineParams) => Candle[]` | 🟢 | |
| `getFundProfile`等6 | `(Symbol,fundType,...) => Fund*` | 🟢 | 强类型范本；但 `getFundNav(range?,navType?)`、`getFundHolders(mergeScope?)` 入参是 `string`（应枚举/联合） |
| `getLimitUpPool` | `(opts?) => ListResult<LimitUpStock>` | 🟢 | 但扩展有重复 `getStockLimitUpPool` 🔴 |
| `getLimitUpLadder` | `() => Promise<unknown>` | 🔴 | 无契约；fuyao 有强类型，必须补 |
| `getAnomalyList/ByStocks` | `(...) => AnomalyStock[]` | 🟢 | |
| `getSkyrocketList`/`getHotStockList`/`...History`/`...RankTrend` | `(...) => HotStock[]` | 🟡 | 4 个"热度"方法 + 扩展 `getStockHot/getMarketHot`，语义重叠、命名不统一 |
| `getDragonTigerList` | `(opts?) => DragonTigerList` | 🟢 | 但扩展有重复 `getDragonTiger` 🔴 |
| `getTradingDays` | `() => TradingDay[]` | 🟢 | 仅有全量列表；缺 `marketStatus/isTradingDay`（见缺口） |

### 扩展方法（54，普遍 🔴/🟡）
| 方法 | 评级 | 关键问题 / 建议 |
|---|---|---|
| `getStockInfo` | 🟡 | `StockInfo` 弱（`[k]:unknown`） |
| `getHolders`/`getLargestHolders`/`getHolderChanges` | 🔴 | 入参 `{code,[k]:unknown}` + 返回 `*HolderItem` 弱；应强类型股东结构 |
| `getTopList` | 🔴 | 入参 `[k]:unknown` |
| `getNews`/`getHKNews`/`getFinanceNews`/`getAnnouncement` | 🟡 | 按市场/类型拆方法；`NewsItem` 弱；建议 `getNews({market?,type?})` 合一 |
| `getMainForce` | 🔴 | 入参弱 + `MainForceItem` 弱（对应 stock-sdk `fundFlow.individual`） |
| `getMarketHot`/`getStockHot`/`getStockFundsFlowing`/`getStockHotIndustry`/`getStockTodaySurge`/`getStockIndustryBoard`/`getStockIndustryFundsFlowing`/`getStockLimitUpPool` | 🔴 | 全部"弱类型透传"，无跨源归一 |
| `getStockLimitUp`/`getStockLimitDown`/`getStockLimitUpList`/`getStockLimitDownList` | 🔴 | 4 个疑似重复（limitUp vs limitUpList 差异不明），弱类型 |
| `getDragonTiger` | 🔴 | 与核心 `getDragonTigerList` 重复且返回弱 |
| `getStockTimeSharing`/`getUsTimeSharing`/`getTimeSharing` | 🔴 | 三分时，入参不统一（见问题1） |
| `getUsQuotes`/`getHkQuotes` | 🔴 | 与 `getQuotes` 重复，入参退化 `codes:string[]` |
| `getUsKline`/`getHkKline` | 🔴 | 与 `getKline` 重复，入参弱 |
| `getAHPremium`/`getStockNewStock`/`getStockAH`/`getStockTradingCalendar` | 🟡 | 弱类型，但语义尚可 |
| `getBlockTrade` | 🟡 | 按 code 可取；但缺 `marketStat/dailyStat`（见缺口） |
| `getFundList`/`getFundInfo`/`getFundHistory`/`getFundRank`/`getFundValuation`/`getFundBonus`/`getFundAsset`/`getFundManager`/`getFundNewFund`/`getFundReits`/`getFundTrades`/`getFundStock`/`getFundFinancing`/`getFundPerformance`/`getFundReference`/`getFundTheme`/`getFundShare`/`getFundTopics`/`getFundCategories` | 🔴 | **一整套弱类型基金接口，与核心强类型基金接口重复/不统一**，字段口径冲突（如 `FundProfile` vs `FundInfo`） |

---

## 四、重构路线建议（分阶段，可回退）

1. **统一行情/K线/分时入口（问题1）**：新增/收敛为 `getQuotes(Symbol[])`、`getKline(KlineParams)`、`getIntraday(Symbol, opts?)`，
   路由按 `symbol.exchange` 分源；`getHkQuotes/getUsQuotes/getHkKline/getUsKline/get*TimeSharing` 改为 `Symbol[]` 入参的别名或删除。
2. **消除重复接口（问题3）**：每个语义只留一套强类型——删 `getStockLimitUpPool`/`getDragonTiger` 弱版；基金两套合并为强类型。
3. **补契约（问题4/5）**：`getLimitUpLadder` 补 `LimitUpLadder` 类型；`listTickers`/`getFundNav`/`getFundHolders`/`getFinancialIndicators` 入参枚举化。
4. **扩展能力归一化（问题2）**：为每个扩展能力定"跨源共有字段"做强类型，源特有字段走可选扩展位。
5. **填 P0 缺口（第二节）**：期权 / 期货 / 北向 / 筹码 / 融资融券 / 概念板块——这些源已支持、App 完全没接入，是"榨干源"的最大漏点。

> 每改一个接口，都要同步更新三处：① `methods.ts` 签名 ② `types.ts` 返回类型 ③ 各源封装实现 + 一致性测试断言。
> 建议按"一个能力域一次 PR"推进，避免 88 方法一次性大改带来的回归风险。
