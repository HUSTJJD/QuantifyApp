# change: eod-picker-cards — 尾盘选股卡片流与自动扫描（下一阶段第二优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。扫描引擎与快照已可用；对标 stock-dashboard EodPicker、moomoo Screener 预设、同花顺「尾盘选股」产品形态。

## Why

`ScannerScreen` 是工具页（勾选条件 → 跑全市场 → 列表），用户真正要的是：

> 14:30 左右打开 App，直接看到「今天尾盘值得看的 5 只」卡片，一键加自选/进候选池。

当前无定时尾盘扫描、无卡片流、结果与盘后摘要未闭环。

## What Changes

### 1. 尾盘预设条件包

内置可保存的「尾盘套餐」（复用 `scanMarket` criteria）：

| 套餐 | 条件 |
|------|------|
| 放量突破 | 量比↑ + 涨幅 2%~7% + 非涨停 |
| 金叉确认 | MACD 今日金叉 + RSI 20~70 |
| 回踩均线 | 近 5 日回踩 MA20 未破 + 今日翻红 |

支持：最近使用、自定义微调（涨幅/量比区间）、保存为我的套餐。

### 2. 卡片流结果 UI

命中标的垂直卡片（全宽）：

```
名称 代码          +3.2%
原因 Tag：放量突破 · MACD金叉
量比 2.1 | 换手 3.4% | 主力净流入 +1.2亿
[加自选] [进候选池] [详情]
```

- 可横滑丢弃（忽略今日不再推）
- 顶部：套餐选择 + 「重新扫描」+ 扫描耗时
- 空态：引导「收盘前 14:20–14:50 最有效」

### 3. 定时自动扫描（可开关）

- 交易日 14:30（可配 14:20/14:30/14:40）后台跑默认套餐
- 结果写入 `scan_snapshot`（来源标记 `eod`）
- 触发应用内提示（复用 Digest/AlertCenter）：「尾盘扫描完成：命中 N 只」
- 与盘后摘要联动：摘要正文追加「尾盘命中 Top3」

### 4. 入口

- 策略 Tab 快捷动作第三项「尾盘选股」
- 首页 MarketMoodBar 可选入口（盘中时段）
- 「我的」原扫描页保留为专家模式

## Impact

- Affected: 新 `src/features/scanner/EodPickerScreen.tsx` `eodPresets.ts` `src/quant/scanner.ts`（criteria 扩展）`src/data/QuoteFeed.ts` 或 `notify/localDigest.ts`（定时）`StrategiesScreen` 入口 `AppNavigator`
- Storage: `scan_snapshot` 增加 `source: 'manual' | 'eod'`；套餐存 `appPrefs` 或 KV
- Risks: 全市场扫描耗时 — 默认只扫本地已同步标的，进度可取消；远程资金流仅对 TopN 补拉

## Acceptance

1. 选择套餐一键扫描出卡片，可加自选/进候选池
2. 开启自动扫描后，交易日 14:30 附近产生快照并提示
3. 盘后摘要包含尾盘命中数
4. 卡片原因 Tag 与实际命中条件一致
