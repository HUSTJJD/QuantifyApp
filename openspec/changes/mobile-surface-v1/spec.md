# change: mobile-surface-v1 — 移动端外观与交互打磨（下一阶段第一优先）

> **状态：待交付**。参考 Opptrix Token 体系、OpenStock 空态/卡片密度、ghostfolio 资产大数字、stock-dashboard 自选行信息密度。

## Why

核心量化闭环（策略 / 回测 / 扫描 / 模拟 / 跟单）已交付，但产品「外壳」仍停留在可用级：

- 加载只有文案，无骨架屏；部分页面硬编码暗色或混用第三方组件
- 自选行信息过稀（仅名称+价格+涨跌幅），与日活场景不匹配
- 首页/自选 ScrollView 嵌套 FlatList，大列表有卡顿风险
- 外部参考（Opptrix / OpenStock / ghostfolio）已有成熟的 Token、分组摘要、净值展示模式，可直接落地

本变更**不新增业务能力**，只提升感知质量、信息密度与性能基线。

## What Changes

### 1. 设计 Token 补全（对齐 Opptrix L1/L2）

在 `src/theme/index.ts` 扩展：

| Token | 取值 | 来源 |
|---|---|---|
| `duration` | `fast:120 / base:200 / slow:320` | Opptrix MOTION |
| `spacing.xxs` | `2` | 对齐 4px 基数前的发丝间距 |
| 语义别名 | `gapCard / paddingCard / radiusCard` | Opptrix `semantic` |

规则：

- 组件禁止硬编码色值/圆角/间距；`IndexBar` 等暗色硬编码迁到 `useAppTheme()`
- 新组件一律走 `components/ui`，禁止再引入 react-native-paper（`AssetScreen` 去 paper）

### 2. 统一骨架屏 + 空态

新增 `components/ui/Skeleton.tsx`（脉冲灰块，支持 line/card/chart 三种形状）：

- 首页：IndexBar / FundFlow / SectorBoard / HotStock / Surge 首帧骨架
- 自选：列表行骨架（价格位占位）
- 资产：大数字 + 曲线骨架（ghostfolio 模式）
- 空态统一走 `EmptyState`：标题 + 一句引导 + 主按钮（OpenStock「Add stocks…」模式）

### 3. 自选行信息密度 + 手势

参考 stock-dashboard Watchlist + Opptrix 分组摘要：

- 行布局：名称/代码 | 价格 | 涨跌幅 | **Sparkline（近 N 日）**；可选量比角标
- 右滑删除（Swipeable），长按进入多选批量移除/改分组
- 分组芯片（h≈28、pill、active 用 primarySoft）+ 选中分组顶区 **2×2 摘要条**（只数 / 持有 / 今日盈亏 / 信号数）
- 排序默认「信号强度 → 涨跌幅」，保留现有 SortToggle

### 4. 列表性能基线

- 首页/自选主列表改单一 `FlatList`（或 FlashList 若已引入），去掉 ScrollView 嵌套
- 行组件 `React.memo` + 稳定 `key`
- 行情轮询仍走现有 `useQuotes`，避免行内再拉

### 5. 资产页对齐 ghostfolio

- 顶部：大号总资产（tabular-nums）+ 净盈亏额/% 双行着色
- 中部：持仓占比条/环（先条形，环图可后置）
- 去掉 paper 组件，改用自家 Card / Value / Section

## Impact

- Affected: `src/theme/index.ts` `src/components/ui/{Skeleton,EmptyState,Card}.tsx` `src/features/home/*` `src/features/watchlist/WatchlistTabScreen.tsx` `src/features/asset/AssetScreen.tsx` `src/components/Sparkline.tsx`（复用）
- Storage: 无 schema 变更；分组摘要数据由现有自选/信号/模拟盘查询聚合
- Risks: Swipeable 在 Android 手势冲突；先做 iOS 验收再调 Android

## Acceptance

1. 冷启动首屏无裸「加载中…」，关键卡片有骨架
2. 自选行含 Sparkline，右滑可删除，分组切换有摘要条
3. 亮/暗主题下无硬编码色块；Asset 页无 paper 残留
4. 自选 ≥50 条时滚动不掉帧（真机粗测）
5. 空自选 / 空信号 / 空资产均有引导型空态
