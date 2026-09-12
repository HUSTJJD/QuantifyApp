# change: watchlist-radar-line — 自选雷达摘要行与加自选报价宽限（下一阶段第七优先）

> **状态：已交付（2026-09-12）**。实现见 src 对应模块；验收项以单测+真机后续补齐为准。。对标 Opptrix `watchlistRadar` + `watchlistQuotePrefetch/Grace`：与 mobile-surface-v1 的 Sparkline/摘要条互补，补「策略/估值/资金」一句话。

## Why

自选行已有名称 + Sparkline + 价格涨跌，仍缺「扫一眼就懂标的状态」：

- 所属行业 / 综合评分档 / 策略倾向 / 估值分位 / 主力净额
- 新加自选后短暂时常出现「--」或失败态，体验差

## What Changes

### 1. 雷达摘要行（第二行副标题）

```
半导体 · B+ · 偏多 · PE 42%分位 · 主力 +1.2亿
```

- 字段可配置（appPrefs）：默认 行业 · 档位 · 倾向；估值/资金为可选
- 单行 numberOfLines=1，次要色、fontSize.xs
- 数据源：本地 SignalEngine/decisionCard 缓存 + 可选轻量估值/资金流（缺省显示「—」）
- **不**在滚动列表内对每行打网络请求；进场批量算或读缓存

### 2. 加自选报价宽限

- 加入自选成功后立刻对单标的 `quotes` prefetch
- 若失败：用详情页 `lastPrice` 写入 `addedPrice` 本地兜底
- **15s 宽限期**：不展示「行情失败」红字，仅价格用兜底值
- 多 key Map 合并，避免错位（对齐 Opptrix multi-key patch）

### 3. 与已有 UI 关系

- 第一行：名称 + 信号 Tag + MiniDaySparkline + 价 + 涨跌（保持）
- 第二行：雷达摘要（本变更）
- 分组摘要条不变

## Impact

- Affected: `WatchlistTabScreen` / `WatchRow` `useQuotes` 或新增 `useWatchRadar` `appPrefs`（雷达字段开关）决策卡缓存可复用
- Risks: 估值/资金接口失败时字段隐藏而非整行报错；勿拖慢首帧

## Acceptance

1. 自选行第二行显示雷达字段；可设置仅「行业·档位·倾向」
2. 新加自选 15s 内不出现失败红字，价格可用兜底
3. 50+ 自选滚动仍流畅（雷达走缓存）
4. 字段缺失显示「—」不布局抖动
