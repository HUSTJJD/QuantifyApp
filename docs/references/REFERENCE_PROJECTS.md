# 外部参考项目索引

> 持续学习用。本地克隆均在 `Desktop/QuantificationResearch/` 下（与 QuantifyApp 同级）。
> 每次学到可落地的设计，追加到「已借鉴」列。

## 一览

| 项目 | 本地路径 | 定位 | 技术栈 | 对我们的价值 |
|------|----------|------|--------|--------------|
| stock-sdk | `QuantifyApp/stock-sdk`（file: 依赖） | A/港/美/基金 行情 SDK | TS、零依赖、CLI/MCP | 主数据源兜底；指标计算；选股/回测 |
| stock-dashboard | `../stock-dashboard` | A 股 Web 看板 | React + Vite + ECharts | 接入层封装、热力图、尾盘选股、自选分组 |
| kline-charts-react | `../kline-charts-react` | Web K 线组件 | React + ECharts + stock-sdk | DataProvider、多市场周期、指标元信息、主题 |
| ghostfolio | `../ghostfolio` | 个人资产组合追踪 | Angular + Material | UI 风格：中性灰阶、大号净值、软卡片 |
| react-native-graph | `../react-native-graph` | RN 折线图 | Skia + Reanimated | 资产净值/权益曲线（已接入 LineGraphView） |
| react-native-kline-chart | `../react-native-kline-chart` | RN K 线蜡烛图 | Skia + Reanimated | **已替换 native-kline-view**；仅蜡烛+MA |
| OpenStock | `../OpenStock` | 开源股票平台 | Next.js + shadcn + Finnhub + TradingView | 全局搜索/快捷面板、告警、onboarding、邮件摘要 |

---

## 1. stock-sdk（已深度集成）

**仓库**：https://github.com/chengzuopeng/stock-sdk  
**本地**：`QuantifyApp/stock-sdk`（`package.json` 为 `file:./stock-sdk`）

### 能力矩阵（A / 港 / 美）

| 能力 | A | 港 | 美 |
|------|:-:|:-:|:-:|
| 实时行情 quotes.cn/hk/us | ✅ | ✅ | ✅ |
| 日周月 K / 分钟 K | ✅ | ✅ | ✅ |
| 分时 timeline / Minute period=1 | ✅ | ✅ | ✅ |
| 筹码 chips | ✅ | ✅ | ✅ |
| 资金流 / 板块 / 龙虎榜 / 北向 / 两融 / 涨停 | ✅ | 南向 | ❌ |

### 可复用 API

- 行情：`sdk.quotes.cn/hk/us`、`sdk.batch.*`
- K 线：`sdk.kline.cn/hk/us` + `*Minute`
- 指标：`calcMA/MACD/BOLL/KDJ/RSI/WR/BIAS/CCI/ATR/OBV/ROC/DMI/SAR/KC`、`addIndicators`
- 信号：`calcSignals`、`screen` 选股、`backtest`
- 资金流：`fundFlow.rank/sectorRank/market/individual`

### 已借鉴

- 多源路由里作兜底源（`StockSdkSource`）
- 盘中资金流排行、热股榜
- 指标计算可逐步切到 SDK `calc*`（与本地 `src/quant/indicators.ts` 并存）

---

## 2. stock-dashboard

**仓库**：https://github.com/chengzuopeng/stock-dashboard  
**本地**：`Desktop/QuantificationResearch/stock-dashboard`

### 功能亮点

- 总览：自选快照 + 市场信息
- 热力图：行业/板块/自选维度
- 板块详情、自选分组、尾盘选股（条件 + 分时）
- 个股详情：多周期 K、指标、资金

### 结构

- `src/services/sdk.ts`：统一封装 + TTL 缓存 + 重试
- `src/pages`：Dashboard / Heatmap / Rankings / Boards / Watchlist / EodPicker / StockDetail

### 已借鉴 / 可借鉴

- 已有：首页热力图、资金流、热股、扫描工作流
- 可借鉴：尾盘选股页交互、板块成分页、缓存策略（TTL 按接口分级）

---

## 3. kline-charts-react

**仓库**：https://github.com/chengzuopeng/kline-charts-react  
**本地**：`Desktop/QuantificationResearch/kline-charts-react`

### 核心设计（已迁到 RN `src/chart/`）

| 设计 | RN 落地 |
|------|---------|
| `MarketType` A/HK/US | `ChartMarket` + `chartMarketOf` |
| `PeriodType` 分时/分钟/日周月 | `ChartPeriod` + `toKlinePeriod` |
| `KLineDataProvider` 可插拔 | `KlineDataProvider` + 默认 `marketData` |
| `INDICATOR_META` 主图/副图 | `src/chart/indicatorMeta.ts` |
| `marketSessions` 多市场时段 | `src/chart/marketSessions.ts` |
| `ThemeConfig` 图表主题 | `src/chart/theme.ts` |
| `useKlineData` 缓存/防抖/loadMore | `src/hooks/useKlineChart.ts` |

**注意**：ECharts / DOM / CSS 不能直接用于 RN；K 线绘制仍用 `native-kline-view`。

---

## 4. ghostfolio

**仓库**：https://github.com/ghostfolio/ghostfolio  
**本地**：`Desktop/QuantificationResearch/ghostfolio`

### UI 风格要点

- 浅色：`#FAFAFA` 底 + 白卡片；暗色：中性深灰卡片（约 `#1E1E1E`），低色相噪音
- 文字层级：主文案 87%、次要 54% 黑/白
- 大号净值数字 + 小标签 + 涨跌色（红/绿）
- 组合比例图、X-Ray、Activity 表

### 已借鉴

- 主题灰阶（`src/theme/index.ts` DarkColors/LightColors）
- `Value` 组件（资产页总资产）
- 资产走势用渐变折线（LineGraphView）

### 可继续借鉴

- 持仓占比环图 / 条形比例
- 交易流水（Activity）列表时间线
- 设置页：数据源、货币、基准指数

---

## 5. react-native-graph

**仓库**：https://github.com/margelo/react-native-graph  
**本地**：`Desktop/QuantificationResearch/react-native-graph`

### 依赖

`@shopify/react-native-skia` + `react-native-reanimated` + `react-native-gesture-handler`

### 已接入

- `src/components/LineGraphView.tsx`：封装 `LineGraph`（渐变、手势 scrub、涨跌着色、双序列）
- Jest / 原生未就绪时回退 `Sparkline` / `DualLineChart`
- **业务侧折线统一走 LineGraphView**：资产走势、回测权益、策略 vs 基准

**真机需原生重编译**（Skia 等新模块）：`pod install` / `yarn android`。

### 适用场景

- 资产净值曲线、回测权益曲线、资金流历史
- **不替代** K 线蜡烛图（仍用 `native-kline-view`）

---

## 6. OpenStock

**仓库**：https://github.com/Open-Dev-Society/OpenStock  
**本地**：`Desktop/QuantificationResearch/OpenStock`  
**许可**：AGPL-3.0（改/部署需开源，勿直接抄代码进商业闭源）

### Tech Stack

Next.js 15 + shadcn/ui + Tailwind + Better Auth + MongoDB + Finnhub + TradingView + Inngest（邮件/AI）

### 功能（可借鉴清单）

| 功能 | 说明 | 对 RN App 的映射 |
|------|------|------------------|
| 全局搜索 + Cmd+K | 防抖、空闲热门股 | 已有 Search；可加快捷面板/最近搜索强化 |
| Watchlist | 每用户独立 | 已有；动态分组已做 |
| 个股详情 | TradingView 图、基本面、情绪 | 有 native-kline + 基本面；可加情绪源 |
| 市场总览 | 热力图、报价、头条 | 已有首页；可加头条流 |
| Onboarding | 国家/目标/风险/行业偏好 | **未做**：首启问卷 → 推荐策略/扫描 |
| 个性化邮件 | 每日摘要（Inngest cron） | **未做**：可做「盘后本地通知摘要」 |
| 告警 | 价格/条件 | 已有价格/指标/策略信号告警 |
| 暗色默认 + shadcn tokens | 设计 token | 已有 Theme；可再对齐 token 命名 |

### 建议落地优先级

1. **首启 Onboarding**（风险偏好 → 默认策略模板/仓位）
2. **盘后摘要通知**（今日扫描命中 + 持仓异动 + 信号）
3. 个股情绪/新闻源（若 SDK 可覆盖）
4. 设置项对齐（货币、基准、通知开关）

---

## 使用约定

1. **学习以设计/交互/数据流为主**；代码拷贝注意 license（OpenStock=AGPL，ghostfolio=AGPL，stock-sdk/dashboard=MIT 等）。
2. 本地路径变更时更新本表。
3. 新借鉴点写到对应项目的「已借鉴」小节，并在代码注释里点明来源。

## 相关本地目录

```
Desktop/QuantificationResearch/
├── QuantifyApp/          # 本 App
│   ├── stock-sdk/        # 本地 SDK（file: 依赖）
│   └── docs/references/REFERENCE_PROJECTS.md  # 本文件
├── stock-dashboard/
├── kline-charts-react/
├── ghostfolio/
├── react-native-graph/
└── OpenStock/
```
