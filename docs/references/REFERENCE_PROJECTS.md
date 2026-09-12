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
| Opptrix | `../Opptrix` | 多市场 AI 投研工作台 | Vite React + 自研 Token/双主题 | Token 三层架构、iOS 移动设计语言、关注分组摘要、任务进度 |
| streetmerchant | 无本地克隆（GitHub jef/streetmerchant） | 24/7 库存探测+通知 | Node + 声明式 store 适配 | 通知扇出、指数退避、命中冷却、轮询卫生 |

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

### 二次深挖（告警 / 搜索）

| 模式 | 说明 | RN 映射 |
|------|------|---------|
| 告警生命周期 | `active / triggered / expiresAt`（默认 90 天） | `userAlertRules` 状态与过期 |
| 创建告警预填价 | 先 getQuote 再开 Modal，阈值预填现价 | AlertRules 新建流 |
| 搜索防抖+空态 | 300ms debounce + 热门股 | SearchScreen |

**路径**：`components/watchlist/{CreateAlertModal,AlertsPanel}.tsx`、`lib/inngest/functions.ts`、`database/models/alert.model.ts`

---

## 7. Opptrix

**仓库**：https://github.com/Travisun/Opptrix  
**本地**：`Desktop/QuantificationResearch/Opptrix`  
**许可**：Apache-2.0（可借鉴设计；商用闭源仍建议只学模式不整段抄）

### Tech Stack

Vite + React（`client-ui`）+ Node 服务；自研三层 Design Token + Opptrix/iOS 双主题；Chat Agent + 工作流技能。

### 外观 / 交互（可借鉴）

| 模式 | 说明 | RN 映射 |
|------|------|---------|
| L1/L2 Token | spacing 4px 基、radius 4–16、MOTION 120–640ms + 语义别名 | 扩展 `src/theme` duration/语义 gap |
| iOS grouped 语言 | 移动端默认 `canvas #F2F2F7` / surface 白 / accent 系统蓝 | 可选浅色风格；暗色继续 Ghostfolio 灰阶 |
| 关注分组芯片 | h26 pill + active soft；选中后 2×2 摘要条 | 自选分组芯片 + 顶区摘要 |
| 管理面板 | Drawer/内嵌面板而非 Modal | CreateGroup 可改 Sheet/Drawer |
| 任务条 | scheduled-jobs「计划—进度—结果」 | 扫描/回测任务状态同构 |

### 功能级

- 「关注|组合|详情」共享分组筛选 → 自选 ⇄ 模拟盘同一 `selectedGroupId`
- 技能 `/` 列表 → 信号解释/策略模板卡片化呈现

### 不适用

三栏桌面布局、Electron 窗口 chrome、Fluent CSS 变量（需 RN 重实现）。

### 关键路径

- `client-ui/src/theme/design-tokens.ts`（L1/L2）
- `client-ui/src/theme/tokens.ts`、`mobileChrome.ts`、`appearanceStorage.ts`
- 分支 `feat/watchlist-groups-panel-design`：`WatchlistGroupsPanel.tsx`、`docs/WATCHLIST-GROUPS-PANEL-DESIGN.md`

### 已借鉴

- `openspec/changes/mobile-surface-v1`：Token 补全、自选分组摘要条、列表密度
- `openspec/changes/quant-visibility`：任务「计划—进度—结果」进工作流页

### 二次深挖（决策卡 / 自选雷达 / 调度 / Onboarding）

| 模式 | 说明 | RN 映射 |
|------|------|---------|
| **StockDecisionCard** | 综合分 → A/B+/B/C/D 分档 + 论点/风险 bullets + legend；策略倾向多空计数；tone 与涨跌色解耦 | 个股详情顶部决策卡；信号详情复用 |
| **自选雷达摘要行** | 第二行压成「行业 · 评分档 · 策略倾向 · PE/PB 分位 · 主力净额」 | Watchlist 行副标题 |
| **加自选报价宽限** | 新加自选立刻 prefetch；失败用 addedPrice；15s 宽限不显示失败态 | `useQuotes` 加自选路径 |
| **Discover Profile × regime** | panic/cautious/neutral/euphoria → 推荐策略 ID 列表 | 策略 Tab「市况 → 推荐模板」chips |
| **统一 ScheduledJob** | once/interval/cron + run 历史 + per-job notify + webhook HMAC 重试 | `quant-scheduler` 内核 |
| **Onboarding 版本文案** | `ONBOARDING_RELEASE_BY_VERSION` + 老用户 updateLine；禁写技术细节 | 升级欢迎屏；价值轮播 |
| Mobile chrome 常量 | hit=40、title 单行省略 | 二级页顶栏 token |

**路径**：分支 `feat/watchlist-groups-panel-design` 下 `client-ui/src/market/{StockDecisionCard,watchlistRadar,discoverProfiles}.ts(x)`；`packages/schedule/src/{service,notify,webhook-retry,next-run}.ts`；`client-ui/src/onboarding/manifest.ts`

### 已映射提案（追加）

- `stock-decision-card`、`watchlist-radar-line`
- `quant-scheduler`、`alert-notify-harden`、`eod-picker-cards`

### 不适用（补充）

Agent 聊天 / MCP 向导 / shell 计划任务 / news OCR 富化管线 / 桌面三栏。

---

## 8. 商业交易 App 模式（无本地克隆，公开产品调研 2025–2026）

> 仅学习交互/信息架构/视觉安全，**不抄代码**。合规边界见「不适合本 App」。

| 产品 | 参考价值 | 关键模式 |
|------|----------|----------|
| moomoo / 富途牛牛 | 选股器、模拟盘同构、Dark 默认 | Screener 多维过滤 + 预设套餐可保存；模拟盘 $1M + 工具齐全 |
| Webull | paperTrade 安全设计、图表手势 | 模拟盘独立视觉标识 + 一键重置；60+ 指标；Quant Rating |
| Tiger Trade | 量化 Lab、异动榜 | 策略心智 + 开放 API；多市场统一账户感 |
| 同花顺 | A 股信息密度、问财 NL 选股 | 「一句话 → 规则 → 列表」；尾盘/概念标签 |
| 东方财富 | 主力资金、涨跌停一览 | 资金流与情绪指标前置 |
| 雪球 | 组合净值心智 | 轻量「晒净值」而非 UGC（本 App 不做社区） |

### 最值得抄（按 ROI）

1. Dark 交易主题 + 涨跌色可配置（红涨绿跌 / 绿涨红跌）
2. 模拟盘 **PAPER 视觉隔离** + 重置一步可达（Webull）
3. 条件选股套餐 + 卡片流（moomoo Screener + stock-dashboard EodPicker）
4. 净值 vs 大盘曲线（头部 App 通用）
5. 行业/集中度归因（ghostfolio X-Ray 的组合侧）

### 不适合本 App

- 券商实盘下单 / 出入金 / 融资融券 / IPO
- 股吧式社区信息流
- 理财商城 / 基金销售
- Level2 逐笔全量渲染

### 已映射提案

- `portfolio-attribution-v2`：行业归因 + 净值 vs 沪深300
- `eod-picker-cards`：尾盘套餐卡片流 + 14:30 自动扫描
- `sim-paper-deep`：模拟盘绩效 + PAPER 视觉隔离
- `alert-notify-harden`：告警状态机 + 冷却 + 扇出 + 退避（streetmerchant + OpenStock）

### 公开参考

- https://www.moomoo.com/screener · https://www.moomoo.com/sg/papertrading
- https://www.webull.com/paper-trading · https://www.webull.com/charts-tools
- https://www.10jqka.com.cn/ · https://wap.eastmoney.com/

---

## 9. streetmerchant（GitHub，无本地克隆）

**仓库**：https://github.com/jef/streetmerchant  
**定位**：24/7 商品有货探测 + 多通道通知（**明确不代下单**）。MIT。

### 核心架构

| 模块 | 机制 | 对 QuantifyApp 的价值 |
|------|------|----------------------|
| `src/store/model/*.ts` | 声明式 Store 适配（labels/links/backoff） | ≈ DataSource 能力声明 |
| `src/store/lookup.ts` | 按 store 独立 `setTimeout` 循环 + 并发 + shuffle | ≈ `watchlist/poller.ts` 错峰拉自选 |
| `helpers/backoff.ts` | 403/429 指数退避，成功减半 | 行情源限流 |
| `IN_STOCK_WAIT_TIME` | 命中后冷却 N 秒 | 告警 per-rule 静默窗 |
| `src/messaging/notification.ts` | 一行扇出 20+ 通道；未配置跳过 | 插件化 `notify/channels/*` |
| dotenv + web API | 配置热改 + 状态矩阵 | 设置改 interval 无泄漏重启 poller |

### 通知通道（扇出设计参考）

优先：sound / ntfy / discord / email / SMS / APNs  
非优先：slack / telegram / mqtt / pushover / bark 类…  
**App 侧优先**：应用内 AlertCenter、系统本地通知、可选 Telegram/Bark Webhook。

### 不适合照搬

puppeteer、自动加购、captcha 绕过、proxy 池、Cloudflare 对抗——与行情无关且有合规风险。仅保留「只探测 + 通知、不代操作」边界（与本 App「不实盘下单」一致）。

### 已映射提案

- `alert-notify-harden`：通知扇出 + 退避 + 命中冷却 + 告警生命周期（叠加 OpenStock 状态机）

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
├── OpenStock/
└── Opptrix/
```
