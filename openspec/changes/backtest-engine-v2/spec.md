# Change: 回测引擎可信性与指标完善（backtest-engine-v2）

## Why

回测模块已能跑通，但存在几类会直接误导决策的问题：
主回测 / 样本内外划分 / 参数扫描三者用了不同配置（撮合方式、成本、公司行为），结果互不可比；
除权场景的盈亏按「买价 vs 卖价」配对，10 送 10 会被算成巨亏；
年化与夏普写死 252，周 / 月 / 分钟 K 的年化会失真；
多标的池只有「收益算术平均」，没有组合视角；强行要求分钟 K 时本地库会静默退化为日 K。

## What Changes

### 引擎 `src/quant/backtest.ts`
- 引入 `barsPerYear` / `riskFreeAnnualPct` 选项，年化与夏普/索提诺不再写死 252
- 新增 `planBuy()`：卖不下的理论最大手数向下回退成交，消除「明明有钱却不成交」
- 引入持仓**净投入** `basis`（买入额+费用 − 分红 + 配股缴款），按此结清单笔往返盈亏，
  移除 O(n²) 的 `[...trades].reverse().find(...)` 配对
- `BacktestTrade` 增加 `pnl / pnlPct / holdingBars`
- `BacktestResult` 增加 `sortino / calmar / volatilityPct / exposurePct / avgHoldingBars /
  bestTradePct / worstTradePct / longestDrawdownBars / trailingDrawdownBars`

### 新模块
- `src/quant/metrics.ts`：回测 / 组合 / 基准共用的绩效纯函数（含 `barsPerYearOfPeriod`）
- `src/quant/portfolio.ts`：多标的等权合成（给出组合净值与收益/风险指标、`fullOverlapPct`）

### 基准对比 `src/quant/benchmark.ts`
- 新增 `beta` / `alphaAnnualPct` / `correlation`
- `computeBenchmarkMetrics(points, barsPerYear)` 支持周期感知年化

### 取数 `src/quant/backtestData.ts`
- `loadBacktestSeries` 返回 `barCount` / `rangeMs` / `periodHonored`
- 新增 `maxBars`：把回测窗口裁剪到最近 N 根，保证样本可复现
- 分钟级请求走本地库时标记 `periodHonored=false` 并在 note 中提示退化为日 K

### 买入持有基准 `src/quant/buyHold.ts`
- `runBuyHold(candles, opts)` 改为选项式入参：复用引擎的 `planBuy`（费用+整手预算）与
  `applyCorpActionsAtBar`（分红/送转/配股），支持 `execution: 'close' | 'nextOpen'`
- 返回 `buyFee` / `corpEvents` / `reason`（资金不足一手时如实报告，不再假装全仓）
- 修复口径漂移：此前买入持有**不计费用也不处理除权**，在不复权链路上 10 送 10 会被算成
  「买入持有 −50%」，凭空制造策略超额收益

### UI `src/features/quant/StrategyBacktestScreen.tsx`
- Row / Detail 保留 `factors`，样本内外划分、参数扫描、买入持有都与主回测共用同一份除权因子
- 买入持有卡片展示持有股数 / 建仓费用 / 除权调整次数 / 建仓价，并说明同口径对照
- 新增「组合（等权合成）」卡片：净值曲线 + 收益/风险指标 + 齐全度说明
- 绩效卡片扩展：索提诺 / 卡玛 / 年化波动 / 最长回撤 / 持仓占比 / 平均持有 / 最佳最差单笔
- 基准区块新增 Beta / 年化 Alpha / 相关系数
- 成交明细显示每笔平仓盈亏率
- 页面卸载取消批量回测；详报切换加请求令牌，避免竞态
- 样本说明显示**真实** bar 数与周期退化提示

### 导出报告 `src/quant/backtestReport.ts`
- 新增 `formatPortfolioSection()`；详报补充新指标与 Alpha/Beta；成交行带本笔盈亏
- `DetailExport` 新增 `buyHold` / `buyHoldExcessPct`：报告中显式标注「同资金/费用/撮合/除权口径」，
  缺失该基准时不输出对照行，避免导出「看似跑赢」的错觉

## Tests

- 新增 `src/quant/__tests__/backtestEngine.test.ts`（19 例）：公司行为盈亏口径、手续费约束下的手数、
  周期感知年化、**派生回测参数透传（walkForward / gridSearch）**、metrics 纯函数、等权合成、
  `maxBars` 与周期退化
- 重写 `__tests__/buyHold.test.ts`（11 例）：费用/整手/`nextOpen`/分红/送股不造假、`不足一手如实未成交`
- 更新 `src/quant/__tests__/backtestReport.test.ts` 夹具并新增对照行用例

## Out of Scope（仍未解决）

- 真正的组合回测（资金竞争 / `maxPositions`）——当前只做等权合成
- 分钟 K 数据落地与 T+1 约束
- 涨跌停 / 流动性撮合
- 回测结果持久化（目前每次进页面全量重算）
