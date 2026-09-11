# DESIGN.md — 锐见 SharpView · 全球股市看板

## 1. Objective

任何一份执行到位的锐见界面，都应让用户在 3 秒内判断「现在全球什么在动、A 股什么在动、我该不该点进个股」。质量线是专业行情终端的信息密度与可信度，而不是消费级资讯 App 的卡片堆叠。

## 2. Product Context

- **What the product does:** 面向 A 股主战场的量化洞察与行情终端——先看全球与大盘，再落到个股信号与交易决策。
- **Who it's for:** 有盘中盯盘习惯、能读懂涨跌/资金流/热力图的个人交易者；偏好红涨绿跌；主战场 A 股，偶尔扫港股/美股映射。
- **Adjacent brands (feel like these):** Bloomberg Terminal（密度与数字权威感）、富途牛牛（多市场条 + 行情层级）、同花顺 App（A 股板块/异动信息架构）。
- **Distant brand (do not feel like this):** 小红书/雪球社区流——不做内容推荐与社交噪音，首页不出现「热议观点」。
- **Cultural register:** serious / technical。数字优先，文案短、无营销腔。

## 3. Visual Foundations

### 3a. Color

沿用现有 Ghostfolio 暗底体系，为看板补一层「终端密度」语义色：

- **Neutral scale (dark):**
  - `--bg: #121212`（比现状更深一档，贴近终端黑）
  - `--surface: #1A1A1A`
  - `--surface-alt: #242424`
  - `--surface-muted: rgba(255,255,255,0.06)`
  - `--border: rgba(255,255,255,0.08)`
  - `--text: #F5F5F5`
  - `--text-secondary: rgba(255,255,255,0.55)`
- **Neutral scale (light):** 保持 `#FAFAFA / #FFFFFF / #F2F4F3` 现有体系。
- **Accent(s):**
  - `--accent-primary: #11BEBC`（品牌青，导航与主操作）
  - `--accent-live: #F5A623`（琥珀：盘中/live/焦点指数高亮，Bloomberg 签名色，**每屏最多 1–2 处**）
- **Semantic (A股默认 cn):**
  - `--up: #F5465C`
  - `--down: #2DCB73`
  - `--flat: rgba(255,255,255,0.38)`
- **Usage rules:**
  - 涨跌色只用于价格与涨跌幅，不用于装饰背景。
  - 青色只用于可点导航/主 CTA/选中态。
  - 琥珀只用于「盘中 live 徽标、当前焦点指数下划线、会话时钟活动点」，禁止铺成区块底色。
  - 热力图色块从 surface 向 up/down 插值，与现有 `SectorBoard.heatColor` 一致。

### 3b. Typography

- **Display / 数字:** 系统等宽或 tabular 数字偏好（iOS `SF Mono` / Android `Roboto Mono` 回退系统 sans + `fontVariant: ['tabular-nums']`）。
- **Body:** 系统字体栈（与现状一致，中文 PingFang SC / 微软雅黑）。
- **Type scale:** `10 / 11 / 13 / 15 / 18 / 22 / 28`（在现有 `fontSize` 上增加 `micro:10` 与 `quote:13` 语义位）。
- **Weight discipline:**
  - 报价数字：600–700
  - 标签/时间戳：400–500
  - 模块标题：600，字号 ≤ 13，不使用大标题抢占首屏

### 3c. Spacing & rhythm

- **Base unit:** 4px
- **Spacing scale:** `2 / 4 / 8 / 12 / 16 / 24`（比现状更紧一档用于看板行）
- **看板行高：** 指数条 cell 高 ≈ 56；个股行情行高 ≈ 52；模块标题带 ≈ 28
- **「Generous」定义：** 看板内禁止大留白；模块间距 12，区块内边距 12；仅搜索与空态允许 24 呼吸。

### 3d. Component seeds

- **Quote row（签名组件）：** 左名称+代码，中现价+涨跌%，右迷你走势；行分隔用 1px border，不用阴影卡片。
- **Session chip：** 亚/欧/美 开/休 + 本地时间；活动会话用琥珀点。
- **Heatmap cell：** 直角或 4px 圆角，文字反差色，块大小=成交额。
- **Button：** 每屏最多 1 个 filled（青）；其余 ghost/text。
- **Iconography：** 现有 `theme/icons` 线性图标，16–20px，不用 emoji。
- **Sparkline：** 复用 `MiniDaySparkline` / `Sparkline`，stroke 跟随 up/down。

## 4. Accessibility

- **Text contrast:** 正文 ≥ 4.5:1；报价数字 ≥ 7:1（暗底浅字）；热力图块内文字按亮度自动切黑/白。
- **Motion:** 默认短促（120–200ms）；系统「减弱动态效果」时关闭价格闪烁与会话点脉冲。
- **Focus indicators:** 2px 青色描边或左侧 2px 选中条；不可只靠颜色表达涨跌（同时保留 + / − 符号与箭头）。
- **Alt text policy:** 热力图/迷你走势为装饰性增强，关键数值始终以文本并排展示，不依赖图形可读。

## 5. Voice & Tone

- **Register:** technical，短句。
- **Sentence rhythm:** 标签 2–6 字；状态 1 句；无长说明。
- **Words this brand uses:** 盘中、收盘、主力净流入、涨停、北向、板块、异动、信号。
- **Words this brand refuses:** 赋能、一站式、全方位、惊喜、悄悄告诉你、财富自由。
- **Address:** 默认无称谓，直接陈述数据；设置页可用「你」。

## 6. Implementation Practices

- **Token format:** 扩展现有 `src/theme`（`getColors` / `spacing` / `fontSize`），看板新增 token 挂到同一导出，禁止组件内硬编码色值（热力图插值除外，且必须走 theme up/down/surface）。
- **Component library:** 继续 `components/ui` + feature 本地组件；看板新组件放 `src/features/home/board/`。
- **Image treatment rules:** 无插图、无装饰摄影；图表全部代码绘制（SVG / ECharts）。
- **Grid system:** 手机单列信息流；指数条 3–4 列等分；热力图 treemap 不等分。
- **Motion rules:** 行情 tick 闪色 120ms；列表不自动滚动；下拉刷新与现状一致。
- **Platform:** Expo SDK 57 / RN 0.86；不引入新图表库，优先 SVG + 既有 ECharts/KLineChart。

## 7. Anti-Patterns

- **No gradient hero / 大色块标题区。** 看板首屏必须是数据，不是品牌视觉。
- **No rounded-16px card grid with icon+title+2 lines。** 模块用分隔线与标题带，不用「六个圆角卡」。
- **No emoji decoration。** 热度、涨跌、会话一律图标或字符（↑↓ ·）。
- **No floating “47% YoY” stat trios。** 独立大数字必须对应可点的行情对象。
- **No “seamless / elevate” copy。**
- **No 自动播放的轮播 Banner。** 信息靠排版优先级，不靠轮播。
- **No 琥珀色大面积使用。** 保持终端感克制。

## 8. Decision-Making

1. **数字可信 > 视觉炫技。** 展示空间不够时砍图形，不砍代码/现价/涨跌幅。
2. **A 股深度 > 全球广度。** 全球条只服务风险偏好与开盘节奏；A 股个股与板块是主内容。
3. **现有模块可折叠/可配置，不删除。** appPrefs 开关继续生效，默认排序按看板 IA 重排。
4. **失败降级优雅。** 单源失败保留缓存/骨架，不整页报错。
5. **一屏一个焦点。** 当前时段（如 A 股盘中）用琥珀标记「当前主会话」，其余市场弱化。

## 9. Workflow

1. 读 `DESIGN.md` + 本 SPEC，确认模块清单与 appPrefs 映射。
2. 先实现数据层常量与 hooks（全球指数、会话、A 股焦点榜），不改 UI 样式 token。
3. 落地 `theme` 增量 token（micro 字号、tabular 数字、更深底色可选）。
4. 实现 `GlobalTickerStrip` → `SessionClock` → `AshareFocusBoard` → 复用/重排既有模块。
5. 热力图与迷你走势对齐 up/down 与密度规则。
6. 亮/暗主题 + 红涨绿跌 scheme 回归。
7. 交易时段轮询与缓存路径验证（`useQuotes` / `QuotesCache`）。
8. typecheck + 相关单测；真机/模拟器过一遍首屏滚动与点进 `StockDetail`。
