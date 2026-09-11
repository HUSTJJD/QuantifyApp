# 主页改造 Spec — Bloomberg 风格全球股市看板（融合现有功能）

| 字段 | 值 |
|------|-----|
| 状态 | Phase 1 已实现（全球条 / 会话 / 中国大盘 / 热力图 / A股焦点 / 资金折叠） |
| 产品 | 锐见 SharpView |
| 范围 | 底部 Tab「行情」首屏 `MainScreen` 及其子组件；不改策略/模拟盘/我的核心逻辑 |
| 设计基准 | `DESIGN.md` |
| 技术栈 | Expo 57 · RN 0.86 · react-navigation · 现有 `marketData` 多源路由 |

---

## 1. 目标与非目标

### 1.1 目标

把首页从「可开关的卡片堆」改造成**信息优先级明确的全球→A股看板**：

1. **全球主要指数 + 涨跌幅**（亚/欧/美），一眼判断外盘节奏。
2. **会话时钟**：哪个市场开盘中、A 股是否盘中。
3. **行业/概念热力图**（已有 treemap，升级为视觉中心）。
4. **实时走势**：指数与焦点个股的迷你分时/日内 sparkline（盘中可刷新）。
5. **聚焦 A 股个股**：异动、热股、资金流榜全部服务「点进个股详情」。
6. **完整融合**现有 MarketMood / Pulse / FundFlow / Surge / Hot / Search 等模块，不丢功能。

### 1.2 非目标（本期不做）

- 不做桌面级 Bloomberg 多窗格 / 键盘命令行。
- 不做全球个股交易链路；全球只到指数层。
- 不改 `StockDetailScreen` 内部结构（仅从首页导航进入）。
- 不新增付费/登录/社区。
- 不引入新后端；全部走现有 `MarketDataClient` / 数据源能力。

---

## 2. 现状盘点（必须融合）

### 2.1 导航与首屏

- Tab：`行情 Main` / `自选` / `策略` / `模拟盘` / `我的`（`AppNavigator.tsx`）。
- `MainScreen` 当前纵向：搜索 → MarketMoodBar → MarketPulseBar → IndexBar（仅上证/深证/北证50）→ FundFlowCard → FundFlowRanksCard → TodaySurgeList → HotStockList → SectorBoard。

### 2.2 已有可复用能力

| 能力 | 位置 | 看板用法 |
|------|------|----------|
| 实时行情轮询 + 缓存 | `useQuotes` / `QuotesCache` | 全球指数条、A 股焦点榜 |
| 指数列表 | `listIndices(tag)` | 行业/概念热力图（已有） |
| 板块热力图 | `SectorBoard` + `utils/treemap` | 升为第二视觉中心，保留行业/概念切换 |
| 日内近似走势 | `MiniDaySparkline`（Quote 五点合成） | 指数条/个股行右侧迷你图，零额外请求 |
| 真实分时 | `getIntraday` | 可选：焦点指数/自选 Top N 拉真实分时（Phase 2） |
| K 线图 | `KLineChart` / ECharts | 不在首页嵌大图；详情页已有 |
| 情绪/涨跌停 | `MarketMoodBar` | 压缩为状态条一行 |
| 北向/两融 | `MarketPulseBar` | 并入 A 股脉搏行 |
| 资金流 | `FundFlowCard` / `FundFlowRanksCard` | A 股区折叠模块 |
| 异动/热股 | `TodaySurgeList` / `HotStockList` | A 股个股焦点榜数据源 |
| 用户偏好 | `appPrefs` | 模块显隐、热力图维度/指标、主战场市场 |
| 涨跌色方案 | `getColors(mode, upDownScheme)` | 沿用 cn 默认 |

### 2.3 数据源能力边界（调研结论）

- **A 股指数/个股/板块/资金流/龙虎榜/北向/两融**：覆盖完整，首页已用。
- **港股/美股 `getQuotes`**：`StockSdkSource` 有 HK/US 路径；可作为全球指数候选源之一。
- **`listIndices('region')`**：fuyao 同花顺区域指数目录；可作全球指数补充，**需实现时用 contract 测试验证字段质量**，失败则回落硬编码 watchlist + `getQuotes`。
- **`getFuturesGlobalSpot`**：全球期货现价；本期仅作 Phase 2「宏观脉搏」可选增强，不进首版必选。
- **非 A 股个股深度**：首页全球区只展示指数，点击可尝试进 Detail，但 Detail 对 US/HK 能力弱于 A 股——UI 标注「指数快照」，避免假装全功能。

---

## 3. 信息架构（自上而下）

阅读顺序模拟专业交易员：**外盘节奏 → 会话 → 中国大盘 → 板块结构 → 个股动作 → 资金细节**。

```
┌─────────────────────────────────────────┐
│ 0 顶栏：搜索 + LIVE 徽标 + 刷新          │
├─────────────────────────────────────────┤
│ 1 全球指数条 GlobalTickerStrip           │
│    横向滚动：标普/纳指/道指/恒生/日经…   │
│    点选切换下方「焦点迷你走势图」        │
├─────────────────────────────────────────┤
│ 2 会话时钟 SessionClock                  │
│    亚洲(沪港) · 欧洲 · 美国  开/休       │
│    A股状态 + 涨停/跌停（可配）           │
├─────────────────────────────────────────┤
│ 3 中国大盘 Board                         │
│    上证/深证/创业板/北证50 + 涨跌%        │
│    + 北向合计 / 两融（可配）              │
│    + 焦点指数日内 sparkline（大号）       │
├─────────────────────────────────────────┤
│ 4 板块热力图 Heatmap (视觉中心)          │
│    行业|概念 × 涨跌|成交额|成交量         │
│    点击 → Detail(板块指数)               │
├─────────────────────────────────────────┤
│ 5 A股个股焦点 AshareFocus                │
│    Tab: 异动 | 热股 | 主力净流入 | 主力净流出 │
│    行：名称/代码 现价 涨跌% [迷你走势]    │
│    点击 → Detail(个股)                   │
├─────────────────────────────────────────┤
│ 6 资金与情绪（可折叠，默认收起一级）     │
│    大盘资金流 · 板块/个股资金流前五       │
│    （原 FundFlow / FundFlowRanks）        │
└─────────────────────────────────────────┘
     底部 Tab 不变
```

**默认排序原则：** 可配置模块仍受 `appPrefs` 开关控制，但**固定骨架不可关**：搜索、全球条、会话、中国大盘、热力图、A股焦点。

---

## 4. 模块规格

### 4.0 顶栏

- 左：产品短名「锐见」或当前主会话名（如「A 股 · 盘中」）。
- 中/下：现有搜索入口（保留 `onSearch`）。
- 右：LIVE 圆点（A 股 `open` 时琥珀呼吸，否则灰）；可选手动刷新按钮（触发 `reload`）。

### 4.1 GlobalTickerStrip — 全球指数条

**目的：** 3 秒内扫完主要外盘涨跌。

**默认标的（可后续配置化）：**

| 显示名 | Symbol 候选 | 市场 |
|--------|-------------|------|
| 上证 | 000001.SH | CN |
| 深成 | 399001.SZ | CN |
| 创业板 | 399006.SZ | CN |
| 恒生 | 需实测 code/exchange（HK） | HK |
| 恒生科技 | 需实测 | HK |
| 标普500 | 需实测 US 指数 code | US |
| 纳指 | 需实测 | US |
| 道指 | 需实测 | US |
| 日经/富时等 | Phase 2，有源再加 | — |

实现约束：

1. 启动时用 `useQuotes(symbols, 'index'|'stock')` 批量拉取；**全球与 A 股可拆两次请求**，避免单源拖垮整体。
2. 任一市场失败：该 cell 显示 `--`，不阻塞其他。
3. Cell 结构：名称缩写 · 现价 · 涨跌%；选中态底部 1px 青色或琥珀线。
4. 横向 `ScrollView`，首屏露出约 3.5 个 cell 提示可滑。
5. 点击 cell → 焦点区切换为该指数；再点一次或点「个股」Tab 回到 A 股默认焦点。

**验收：** 无网时展示骨架或 `--`；有缓存先秒显（沿用 `QuotesCache`）。

### 4.2 SessionClock — 会话时钟

**目的：** 解释「为什么美股是隔夜价」，降低误读。

数据：

- 优先 `getMarketStatus('A')`（已有）。
- HK/US 状态：若无 API，用本地时区规则近似（港股 09:30–16:00 HKT 工作日；美股美东 09:30–16:00，需处理 UTC 偏移与夏令时可用简化表 + 文案「近似」）。Phase 1 允许 US/HK 仅显示「开/休」灰点，不显示精确盘中。

UI：

- 三段：`沪港` / `欧` / `美`。活动段用琥珀点 + 实心字，休市用次级色。
- 紧凑一行，与涨跌停数字并列（原 MarketMoodBar 压缩，不再独立大卡）。

### 4.3 ChinaBoard — 中国大盘

融合：`IndexBar` 扩展 + `MarketPulseBar`。

- 指数：上证、深成、创业板指、北证50、科创50（有源则加）。
- 布局：2×2 或 1×4 密集网格；名称小、价格 tabular 大、% 带符号。
- 下方脉搏行：北向净买 · 两融余额（现有逻辑）。
- 右侧或下方：**当前焦点指数**大号日内走势（`getIntraday` 或 MiniDay 兜底），高度 ~120。

### 4.4 Heatmap — 板块热力图（视觉中心）

- 复用 `SectorBoard`，布局上移至首屏半程内可见。
- 保留维度：行业 / 概念；指标：涨跌 / 成交额 / 成交量（appPrefs）。
- 交互增强：
  - 点击板块 → Detail（已有）。
  - 长按或角标展示前 3 成分涨跌（可选 Phase 2）。
- 密度：最小高度 280，最大 420（略收紧现状 560，给下方个股留空间）。
- 标题带：`板块热力` + 右侧分段控件，不用独立 Card 阴影。

### 4.5 AshareFocus — A 股个股焦点（主内容）

**目的：** 首页「聚焦 A 股个股」的核心落点。

分段 Tab（单行 chip）：

| Tab | 数据 | 现有组件 |
|-----|------|----------|
| 异动 | `getStockTodaySurge` | TodaySurgeList 逻辑下沉 |
| 热股 | `getHotStockList` | HotStockList 逻辑下沉 |
| 主力流入 | `getStockFundsFlowing` 流入排序 | FundFlowRanks 部分 |
| 主力流出 | 同上流出排序 | 同上 |

行组件 `AshareQuoteRow`：

```
[名称          ] [现价    ] [涨跌%   ]
[600519 · 白酒  ] [1680.00] [+1.25% ]
                 [迷你走势 sparkline]
```

- 点击整行 → `onOpen(symbol)` → Detail。
- 盘中：`useQuotes` 对当前列表前 N（默认 20）做轮询，刷新现价/%。
- 异动/热股列表本身可能只有名称无价：批量 `getQuotes` 补价。
- 默认停在「异动」；记住 `appPrefs.ashareFocusTab`。

列表高度：内嵌纵向列表最多显示 8 行 +「更多」进入原独立流或 Search；或整页滚动中直接列 10 行（推荐，与现 HotStockList 一致）。

### 4.6 资金与情绪折叠区

- 标题「资金 · 情绪」+ chevron。
- 默认**展开**（保证融合可见），用户可折叠；状态存 `appPrefs.homeFundsCollapsed`。
- 内容：原 FundFlowCard + FundFlowRanksCard 垂直堆叠，样式去大卡阴影，改 Section + 分隔线。

### 4.7 搜索

保持顶部入口，文案「搜索股票、指数、基金」；不改 SearchScreen。

---

## 5. 与 appPrefs 映射

首页模块**固定展示**，不再提供显隐开关（已删除 `showHotStocks` / `showLimitBoard` / `showFundFlow` / `showFundFlowRanks` / `showMarketPulse` / `showTodaySurge` / `showGlobalStrip` 及设置页「首页模块」区）。

| 键 | 行为 |
|----|------|
| `heatmapTag` / `heatmapMetric` | 热力图维度与颜色指标（页内 chip 可改） |
| `ashareFocusTab` | A 股焦点默认 Tab |
| `homeFundsCollapsed` | 资金折叠区是否收起 |
| `homeFocusIndex` | 主焦点指数 fullCode，默认 `000001.SH` |
| `quoteIntervalSec` | 沿用；看板轮询默认 15s 对齐 `useQuotes` |

---

## 6. 主题与视觉 delta

相对现状 `theme/index.ts`：

1. 暗色 `background` 建议 `#121212`（现 `#191919`），surface 微调更黑；若担心回归可先只加看板局部深底。
2. 新增 `fontSize.micro = 10`、`fontSize.quote = 13`。
3. 新增 `colors.live = #F5A623`（琥珀 live），写入 `ColorScheme`。
4. 报价文本统一 helper：`+1.25%` / `−0.80%`（注意负号），颜色 `up/down`，`fontVariant tabular-nums`。
5. 亮色模式同等布局，仅换色。

不在本期强制全局「终端黑」品牌重做；首页看板是密度试点。

---

## 7. 数据流与性能

```
MainScreen
 ├─ useQuotes(CN indices)          // 15s 盘中
 ├─ useQuotes(Global indices)      // 15s；失败降级
 ├─ SessionClock                   // 状态拉取 + 本地近似
 ├─ SectorBoard                    // listIndices + quotes（已有）
 ├─ AshareFocus
 │    ├─ list API (surge/hot/flow)
 │    └─ useQuotes(top 20)         // 补价/刷新
 └─ Funds (lazy after first paint)
```

规则：

- 首屏优先：搜索 + 全球条 + 会话 + 中国大盘 先出；热力图与焦点列表并行。
- 方法缓存 TTL 沿用 `MethodCache`（quote 5s、hot 5min 等）。
- 后台 tab 失焦：`useIsFocused` 暂停（现有模式）。
- 不在 ScrollView 外嵌套第二层长虚拟列表；焦点列表直接 map ≤20 行，FlashList 留给自选/搜索。

---

## 8. 导航契约

| 交互 | 目标 |
|------|------|
| 全球/中国指数点击（选中） | 首页内焦点切换 |
| 热力图板块点击 | `Detail` 板块指数 |
| 个股行点击 | `Detail` 个股 |
| 搜索 | `Search` |
| Tab 切换 | 不变 |

`MainScreen` props 保持 `{ onOpen, onSearch }`，无需改 `AppNavigator` 结构。

---

## 9. 组件与文件规划

```
src/features/home/
  MainScreen.tsx              // 重排装配
  board/
    GlobalTickerStrip.tsx
    SessionClock.tsx
    ChinaBoard.tsx
    AshareFocusBoard.tsx
    AshareQuoteRow.tsx
    FocusIntradayChart.tsx    // Phase1 可用 MiniDay 兜底
    FundsSection.tsx          // 折叠壳
  IndexBar.tsx                // 保留或由 ChinaBoard 吸收
  SectorBoard.tsx             // 微调高度与标题带
  MarketMoodBar.tsx           // 逻辑迁入 SessionClock 后可删或薄包装
  MarketPulseBar.tsx          // 迁入 ChinaBoard
  FundFlowCard.tsx / FundFlowRanksCard.tsx / TodaySurgeList.tsx / HotStockList.tsx
    // 保留实现，或抽 hooks 供 board 复用；避免复制粘贴
src/settings/appPrefs.ts      // 新增 4 个 key
src/theme/index.ts            // live 色 + micro 字号
```

**原则：** 优先复用/抽取数据 hook，不大规模 rewrite 旧组件；旧组件若废弃则删除，不留死代码。

---

## 10. 分期

### Phase 1 — 骨架与全球条（首版交付）

1. 主题 delta + appPrefs 迁移。
2. `SessionClock` + 压缩涨跌停。
3. `ChinaBoard`（扩展指数 + 脉搏）。
4. `GlobalTickerStrip` + 焦点指数 MiniDay 大图。
5. `AshareFocusBoard` 四 Tab + 补价轮询 + 进 Detail。
6. `SectorBoard` 上移与样式对齐。
7. 资金折叠区融合旧卡。
8. typecheck / 手测亮暗主题。

### Phase 2 — 真实分时与全球增强

1. 焦点指数/个股 `getIntraday` 真分时替换近似路径。
2. `listIndices('region')` 动态全球目录 + 自定义排序。
3. `getFuturesGlobalSpot` 宏观条（美元/原油/黄金/铜）。
4. 热力图长按成分预览。
5. HK/US 精确会话状态（若有源）。

### Phase 3 — 体验

1. 价格变动微动效（respect reduced motion）。
2. 焦点指数用户可选持久化 UI。
3. 首页模块编辑模式（拖拽排序）——仅当用户强烈需要。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 美/港股指数 code 不在源内 | 启动探测 + 失败隐藏该 cell；文档写明候选清单 |
| 首屏请求过多 | 分批、缓存、失败隔离；资金流懒加载 |
| 与「Ghostfolio 轻量感」偏离 | 仅首页密度化；其他 Tab 不变 |
| 热力图过大挡个股 | 限制 maxHeight；焦点区 sticky chip 可选 |
| Detail 对 HK/US 弱 | 全球条主交互是扫读+选中，不强推进个股 |

---

## 12. 验收清单（Phase 1）

- [ ] 启动 ≤ 首屏：搜索、全球条（≥3 个有效指数或降级 `--`）、会话、上证等 ≥3 指数。
- [ ] 盘中 LIVE 琥珀点显示；收盘后变灰。
- [ ] 热力图行业/概念与涨跌指标切换可用，点击进 Detail。
- [ ] A 股焦点四 Tab 可切换；行含名称/现价/%；点击进个股 Detail。
- [ ] 涨跌停、北向/两融、大盘资金、资金流前五、异动、热股全部默认可见（无显隐开关）。
- [ ] `appPrefs` 仅保留看板状态 key（heatmap / focusTab / fundsCollapsed / focusIndex）。
- [ ] 亮/暗主题、红涨绿跌显示正确。
- [ ] `npm run typecheck:app` 通过；关键路径手测无崩溃。

---

## 13. Decision Trace

```json
[
  {
    "decision": "全球只做指数条 + 会话时钟，不做全球个股交易/深度页",
    "reason": "用户目标是全球看板再聚焦 A 股个股；现有 Detail/量化/模拟盘均 A 股优先，扩全球个股成本高收益低",
    "alternatives": ["全球个股列表", "多市场 Tab 切换首页"],
    "tradeoff": "港美用户只能扫指数，不能在首页完成美股选股闭环"
  },
  {
    "decision": "迷你走势优先用 Quote 五点合成的 MiniDaySparkline，真实 getIntraday 放 Phase 2",
    "reason": "零额外请求即可满足「实时走势」观感；intraday 仅当日且各源覆盖不一，首版强依赖会拖垮稳定性",
    "alternatives": ["首页直接 getIntraday×N", "嵌 KLineChart 大图"],
    "tradeoff": "走势是近似路径，不能当精确分时读"
  },
  {
    "decision": "热力图保持 treemap 并上移为视觉中心，而不是改成列表或网格表",
    "reason": "已有 squarify + 颜色插值，Bloomberg/富途板块热力本质也是块面积编码；列表会丢掉结构信息",
    "alternatives": ["行业涨跌榜列表", "等大九宫格"],
    "tradeoff": "小屏上块内文字可能截断，需字号与最小面积约束"
  },
  {
    "decision": "融合方式为重排 IA + 抽薄组件，而非删除旧卡片",
    "reason": "用户明确要求现有功能融合；appPrefs 开关与设置页已存在，删除会造成功能回归",
    "alternatives": ["全新首页替换", "旧模块全部默认折叠"],
    "tradeoff": "代码迁移期存在新旧组件并存，需避免双份请求"
  },
  {
    "decision": "琥珀色仅作 LIVE/焦点强调，主品牌色仍为青",
    "reason": "Bloomberg 签名琥珀需要出现，但锐见已建立 #11BEBC 品牌与设置/导航体系，全盘改橙会破坏一致性",
    "alternatives": ["全面琥珀终端皮", "完全不用琥珀"],
    "tradeoff": "「终端感」弱于真 Bloomberg，属于移动端品牌折衷"
  },
  {
    "decision": "会话时钟 HK/US 允许近似开/休，不阻塞 Phase 1",
    "reason": "仅有 getMarketStatus('A')；精确多市场交易日历无现成 API，近似已能服务「外盘是否在动」",
    "alternatives": ["自建全球交易日历", "等后端"],
    "tradeoff": "节假日/夏令时边界可能误标，需文案或 Phase 2 校准"
  },
  {
    "decision": "A 股焦点榜默认 Tab=异动，而不是热股",
    "reason": "首页任务是「今天什么在动」；异动比人气更贴近盘中决策，热股已有独立认知",
    "alternatives": ["默认热股", "默认主力流入"],
    "tradeoff": "异动源失败时需自动回落热股，否则焦点区空"
  },
  {
    "decision": "暗色底加深到 #121212 作为看板试点，而非全 App 强制",
    "reason": "贴近终端黑增强数字对比，但大范围改主题回归成本高",
    "alternatives": ["全 App 换底", "维持 #191919 不动"],
    "tradeoff": "首页与其他 Tab 底色可能有轻微不一致，需接受或后续统一"
  }
]
```

---

## 14. 开放问题（实现前可再确认）

1. 全球指数最终名单与 code：以实现时源探测为准，默认 8 个。
2. 是否需要首页「宏观期货」条进 Phase 1？（Spec 默认 Phase 2）
3. 焦点指数大图高度 120 是否接受，或希望与热力图同权重。

---

## 15. 参考（代码锚点）

- 首屏装配：`src/features/home/MainScreen.tsx`
- 导航：`src/navigation/AppNavigator.tsx`
- 行情 hook：`src/hooks/useMarketData.ts`
- 方法契约：`src/data/api/methods.ts`（`getQuotes` / `getIndexQuotes` / `getIntraday` / `getHotStockList` / `getStockTodaySurge` / `getStockFundsFlowing` / `getMarketStatus`）
- 热力图：`src/features/home/SectorBoard.tsx` + `src/utils/treemap`
- 迷你走势：`src/components/ui/MiniDaySparkline.tsx`
- 偏好：`src/settings/appPrefs.ts`
- 主题：`src/theme/index.ts`
